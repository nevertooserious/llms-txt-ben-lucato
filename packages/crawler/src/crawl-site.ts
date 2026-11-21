import type {
  CrawlFailure,
  CrawlFailureReason,
  CrawlResult,
  CrawlStopReason,
  DiscoverySource,
  FetchMethod,
  KnownPage,
  LinkSignals,
  RawPage,
} from '@llms-txt/contracts';
import { HeadlessRenderer } from './headless-renderer';
import { HttpFetcher, type FetchOutcome, type FetchRequest } from './http-fetcher';
import { cleanUrlForFetch, isInScope, normaliseUrl } from './normalise-url';
import { parseSitemap } from './parse-sitemap';
import { readPageSignals, type PageSignals } from './read-page-signals';
import { looksLikeJavaScriptShell, renderedPageIsBetter, renderingAddsContent } from './render-decision';
import {
  parseRobotsTxt,
  ROBOTS_TXT_MAX_PARSED_BYTES,
  robotsTxtUnavailable,
  robotsTxtUnreachable,
  type RobotsRules,
} from './robots-rules';
import type { HostnameResolver, NetworkPolicy } from './ssrf-guard';

export interface CrawlSiteOptions {
  /** sites.root_url: scheme, host and optional path prefix. */
  rootUrl: string;
  /** Most pages to fetch. Discovery requests (robots.txt, sitemaps, llms.txt, .md probes) do not count. */
  pageBudget: number;
  /**
   * sites.requires_headless_rendering from an earlier crawl. When null or absent, this
   * crawl decides it by fetching the homepage both ways.
   */
  requiresHeadlessRendering?: boolean | null;
  /** Production leaves this out (public internet only). */
  networkPolicy?: NetworkPolicy;
  resolveHostname?: HostnameResolver;
  /** Least time between two requests to the site. robots.txt Crawl-delay can raise it. */
  minRequestIntervalMs?: number;
  /**
   * No new page is fetched after this long. Crawl-delay is honoured as the site gives it,
   * so a slow site gets fewer pages, not faster requests.
   */
  maxCrawlDurationMs?: number;
  /** Longest wait honoured for a 429's Retry-After before giving up on that URL. */
  maxRetryAfterMs?: number;
  /**
   * A renderer shared across crawls, so its concurrency limit is global to the worker.
   * When absent, the crawl makes its own and closes it at the end.
   */
  headlessRenderer?: HeadlessRenderer;
  /** Called as pages are discovered and fetched, to update pipeline_runs progress. */
  onProgress?: (progress: CrawlProgress) => void;
  /**
   * Called with each page as soon as it is fetched, and awaited before the next fetch,
   * so the caller can extract and store it and let the HTML go. The crawl keeps no page
   * bodies itself.
   */
  onPage: (page: RawPage) => void | Promise<void>;
  /**
   * Pages stored from earlier crawls. Each is queued as well as anything discovery finds,
   * so a page no longer linked is still re-checked and a removal is seen. A known page
   * with validators is fetched with a conditional GET.
   */
  knownPages?: readonly KnownPage[];
  /**
   * sites.sitemap_lastmod_is_trusted. When true, a known page whose sitemap <lastmod> has
   * not moved since the last crawl is not requested at all.
   */
  sitemapLastModifiedIsTrusted?: boolean;
}

export interface CrawlProgress {
  pagesDiscovered: number;
  pagesFetched: number;
  pagesFailed: number;
}

export type { CrawlFailure, CrawlResult, CrawlStopReason };

const HTML_TYPES = ['text/html', 'application/xhtml+xml'];
/** The sitemaps protocol caps a sitemap file at 50 MB uncompressed. */
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'];

/** Sitemap files fetched per crawl, index files included. */
const MAX_SITEMAP_FETCHES = 10;
/** Sitemap URLs kept per page of budget; a huge sitemap need not be held in full. */
const SITEMAP_ENTRIES_PER_BUDGETED_PAGE = 4;
/** Fetch attempts per page of budget; failures do not use budget, so they need their own cap. */
const ATTEMPTS_PER_BUDGETED_PAGE = 2;
/** .md probes that may miss before the site is assumed to have none. */
const MARKDOWN_PROBES_BEFORE_GIVING_UP = 3;

// Seeds of the same depth are fetched in this order.
const SOURCE_PRIORITY: Record<DiscoverySource, number> = {
  navigation: 0,
  existing_llms_txt: 1,
  sitemap: 2,
  page_link: 3,
};

interface FrontierEntry {
  /** The normalised URL: the page's identity. */
  url: string;
  /** What is requested: the URL as first linked, cleaned only as far as RFC 3986 allows. */
  fetchUrl: string;
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  sitemapLastModified: string | null;
  order: number;
}

interface FetchedPage {
  finalUrl: string;
  httpStatusCode: number;
  headers: Record<string, string>;
  html: string;
  fetchMethod: FetchMethod;
}

/**
 * Discovery (robots.txt, sitemaps, an existing llms.txt, homepage navigation), then a
 * prioritised breadth-first crawl under the page budget. Plain HTTP by default; headless
 * rendering for the whole site when the homepage comparison says so, and for single
 * pages whose plain HTML is an empty JavaScript shell.
 */
export async function crawlSite(options: CrawlSiteOptions): Promise<CrawlResult> {
  const crawl = new SiteCrawl(options);
  try {
    return await crawl.run();
  } finally {
    await crawl.close();
  }
}

class SiteCrawl {
  private readonly rootUrl: string;
  private readonly fetcher: HttpFetcher;
  private renderer: HeadlessRenderer | undefined;
  private readonly ownsRenderer: boolean;
  private robots: RobotsRules = robotsTxtUnavailable;
  private requestIntervalMs: number;
  private lastRequestAt = 0;

  private requiresHeadlessRendering: boolean | null;
  private readonly frontier = new Map<string, FrontierEntry>();
  private readonly pending = new Set<string>();
  private readonly fetchedUrls = new Set<string>();
  private readonly inboundLinkSources = new Map<string, Set<string>>();
  private readonly navigationUrls = new Set<string>();
  private readonly knownPages = new Map<string, KnownPage>();
  /** Normalised URLs of the pages passed to onPage, in order. */
  private readonly emittedUrls: string[] = [];
  private readonly unchangedPerSitemapUrls: string[] = [];
  private readonly failedFetches: CrawlFailure[] = [];
  private markdownProbeMisses = 0;
  private markdownVariantsFound = false;
  private insertionOrder = 0;
  private readonly fetchRootUrl: string;
  private readonly deadline: number;

  constructor(private readonly options: CrawlSiteOptions) {
    const rootUrl = normaliseUrl(options.rootUrl);
    if (rootUrl === null) throw new Error(`not a crawlable root URL: ${options.rootUrl}`);
    this.rootUrl = rootUrl;
    this.fetchRootUrl = cleanUrlForFetch(options.rootUrl)!;
    this.deadline = Date.now() + (options.maxCrawlDurationMs ?? 15 * 60_000);
    this.fetcher = new HttpFetcher({ networkPolicy: options.networkPolicy, resolveHostname: options.resolveHostname });
    this.renderer = options.headlessRenderer;
    this.ownsRenderer = options.headlessRenderer === undefined;
    this.requestIntervalMs = options.minRequestIntervalMs ?? 500;
    this.requiresHeadlessRendering = options.requiresHeadlessRendering ?? null;
    for (const knownPage of options.knownPages ?? []) this.knownPages.set(knownPage.normalisedUrl, knownPage);
  }

  async run(): Promise<CrawlResult> {
    const decidedBefore = this.requiresHeadlessRendering !== null;
    await this.loadRobotsTxt();
    if (this.robots.status === 'unreachable') return this.result('robots_txt_unreachable', decidedBefore);

    this.addToFrontier(this.fetchRootUrl, 0, 'navigation', null);
    await this.seedFromSitemaps();
    await this.seedFromExistingLlmsTxt();
    this.seedFromKnownPages();

    for (;;) {
      if (this.emittedUrls.length >= this.options.pageBudget) return this.result('page_budget', decidedBefore);
      if (this.fetchedUrls.size >= this.options.pageBudget * ATTEMPTS_PER_BUDGETED_PAGE) {
        return this.result('attempt_limit', decidedBefore);
      }
      if (Date.now() >= this.deadline) return this.result('time_limit', decidedBefore);
      const entry = this.takeNextFromFrontier();
      if (entry === undefined) return this.result('frontier_exhausted', decidedBefore);
      await this.crawlPage(entry);
      this.reportProgress();
    }
  }

  private result(stopReason: CrawlStopReason, decidedBefore: boolean): CrawlResult {
    return {
      robotsTxtStatus: this.robots.status,
      stopReason,
      pagesFetchedCount: this.emittedUrls.length,
      linkSignals: Object.fromEntries(this.emittedUrls.map((url) => [url, this.linkSignalsFor(url)])),
      unchangedPerSitemapUrls: this.unchangedPerSitemapUrls,
      failedFetches: this.failedFetches,
      requiresHeadlessRendering: this.requiresHeadlessRendering ?? false,
      decidedHeadlessRendering: !decidedBefore && this.requiresHeadlessRendering !== null,
    };
  }

  async close(): Promise<void> {
    await this.fetcher.close();
    if (this.ownsRenderer) await this.renderer?.close();
  }

  // --- discovery -------------------------------------------------------------------

  /** RFC 9309, section 2.3.1. See robots-rules.ts for the table. */
  private async loadRobotsTxt(): Promise<void> {
    const robotsTxtUrl = new URL('/robots.txt', this.rootUrl).href;
    const outcome = await this.politeFetch({
      url: robotsTxtUrl,
      // Parsed whatever its media type; only the first 500 KiB need be read.
      acceptedContentTypes: ['*/*'],
      maxResponseBytes: ROBOTS_TXT_MAX_PARSED_BYTES,
      truncateAtMaxBytes: true,
    });

    if (outcome.kind === 'failed') {
      const isUnavailable = ['too_many_redirects', 'invalid_url', 'unsupported_scheme'].includes(outcome.reason);
      this.robots = isUnavailable ? robotsTxtUnavailable : robotsTxtUnreachable;
      if (!isUnavailable) this.recordFailure(robotsTxtUrl, 'robots_txt_unreachable', outcome.message);
      return;
    }
    const status = outcome.httpStatusCode;
    // Keyed on the requested URL: rules reached through a redirect still govern this host (RFC 9309, 2.3.1.2).
    if (status >= 200 && status < 300) this.robots = parseRobotsTxt(robotsTxtUrl, outcome.body);
    else if (status >= 500) {
      this.robots = robotsTxtUnreachable;
      this.recordFailure(robotsTxtUrl, 'robots_txt_unreachable', `HTTP ${status}`, status);
    } else this.robots = robotsTxtUnavailable;

    if (this.robots.crawlDelaySeconds !== null) {
      this.requestIntervalMs = Math.max(this.requestIntervalMs, this.robots.crawlDelaySeconds * 1000);
    }
  }

  private async seedFromSitemaps(): Promise<void> {
    const listedInRobotsTxt = this.robots.sitemapUrls.length > 0;
    const queue = listedInRobotsTxt ? [...this.robots.sitemapUrls] : [new URL('/sitemap.xml', this.rootUrl).href];
    const seen = new Set<string>();
    const maxEntries = this.options.pageBudget * SITEMAP_ENTRIES_PER_BUDGETED_PAGE;
    let entriesAdded = 0;

    while (queue.length > 0 && seen.size < MAX_SITEMAP_FETCHES && entriesAdded < maxEntries) {
      const sitemapUrl = queue.shift()!;
      if (seen.has(sitemapUrl)) continue;
      seen.add(sitemapUrl);
      // A sitemap robots.txt lists is invited; one found by guessing is subject to its rules.
      if (!listedInRobotsTxt && !this.isAllowedByRobots(sitemapUrl)) continue;
      const outcome = await this.politeFetch({
        url: sitemapUrl,
        // Sitemaps are served under many media types; the parser decides what it is.
        acceptedContentTypes: ['*/*'],
        maxResponseBytes: MAX_SITEMAP_BYTES,
        decompressGzip: true,
      });
      if (outcome.kind !== 'response' || outcome.httpStatusCode !== 200) continue;

      const sitemap = parseSitemap(outcome.body);
      if (sitemap.kind === 'sitemapindex') {
        queue.push(...sitemap.sitemapUrls);
      } else if (sitemap.kind === 'urlset') {
        for (const { url, lastModified } of sitemap.entries) {
          if (entriesAdded >= maxEntries) break;
          if (this.addToFrontier(url, 1, 'sitemap', lastModified)) entriesAdded += 1;
        }
      }
    }
  }

  /** The spec puts llms.txt at the root path, or optionally under a subpath. */
  private async seedFromExistingLlmsTxt(): Promise<void> {
    const candidates = [...new Set([`${this.rootUrl}/llms.txt`, new URL('/llms.txt', this.rootUrl).href])];
    for (const llmsTxtUrl of candidates) {
      if (!this.isAllowedByRobots(llmsTxtUrl)) continue;
      const outcome = await this.politeFetch({ url: llmsTxtUrl, acceptedContentTypes: TEXT_TYPES });
      if (outcome.kind !== 'response' || outcome.httpStatusCode !== 200) continue;
      for (const match of outcome.body.matchAll(/\]\(\s*<?([^)\s>]+)>?\s*\)/g)) {
        const linkedUrl = htmlUrlForMarkdownLink(match[1]!, outcome.finalUrl);
        if (linkedUrl !== null) this.addToFrontier(linkedUrl, 1, 'existing_llms_txt', null);
      }
      return;
    }
  }

  /**
   * Known pages go in after discovery, so a URL discovery found keeps the form the site
   * links today. Scope and robots.txt apply to them as to any other URL.
   */
  private seedFromKnownPages(): void {
    for (const knownPage of this.knownPages.values()) {
      this.addToFrontier(knownPage.fetchUrl, knownPage.crawlDepth, knownPage.discoveredVia, null);
    }
  }

  /** robots.txt rules for a URL on this site's host. robots.txt itself is always allowed. */
  private isAllowedByRobots(url: string): boolean {
    return this.robots.isAllowed(url);
  }

  /**
   * For redirect targets. Rules on this host are checked; another host's robots.txt is
   * not fetched, and a target off this site is out of scope and dropped after the fetch.
   */
  private isRedirectAllowed = (url: string): boolean =>
    new URL(url).host !== new URL(this.rootUrl).host || this.isAllowedByRobots(url);

  /** Adds an in-scope, allowed URL; returns true if it was new. */
  private addToFrontier(
    rawUrl: string,
    crawlDepth: number,
    discoveredVia: DiscoverySource,
    sitemapLastModified: string | null,
  ): boolean {
    const url = normaliseUrl(rawUrl);
    const fetchUrl = cleanUrlForFetch(rawUrl);
    if (url === null || fetchUrl === null || !isInScope(url, this.rootUrl)) return false;
    if (!this.isAllowedByRobots(fetchUrl)) return false;

    const existing = this.frontier.get(url);
    if (existing !== undefined) {
      existing.crawlDepth = Math.min(existing.crawlDepth, crawlDepth);
      existing.sitemapLastModified ??= sitemapLastModified;
      return false;
    }
    this.frontier.set(url, { url, fetchUrl, crawlDepth, discoveredVia, sitemapLastModified, order: this.insertionOrder++ });
    this.pending.add(url);
    return true;
  }

  private takeNextFromFrontier(): FrontierEntry | undefined {
    let best: FrontierEntry | undefined;
    for (const url of this.pending) {
      const entry = this.frontier.get(url)!;
      if (best === undefined || compareEntries(entry, best) < 0) best = entry;
    }
    if (best !== undefined) this.pending.delete(best.url);
    return best;
  }

  // --- fetching --------------------------------------------------------------------

  private async crawlPage(entry: FrontierEntry): Promise<void> {
    if (this.fetchedUrls.has(entry.url)) return;
    if (this.isUnchangedPerSitemap(entry)) {
      this.unchangedPerSitemapUrls.push(entry.url);
      return;
    }
    this.fetchedUrls.add(entry.url);

    const page = await this.fetchPage(entry);
    if (page === null) return;

    // A redirect elsewhere in scope lands on a URL that may also be in the frontier.
    const finalUrl = normaliseUrl(page.finalUrl);
    if (finalUrl === null || !isInScope(finalUrl, this.rootUrl)) return;
    if (finalUrl !== entry.url) {
      if (this.fetchedUrls.has(finalUrl)) return;
      this.fetchedUrls.add(finalUrl);
      this.pending.delete(finalUrl);
    }

    const isSuccess = page.httpStatusCode >= 200 && page.httpStatusCode < 300;
    let hasNoindexDirective = false;
    let markdownVariantUrl: string | null = null;
    if (isSuccess) {
      const signals = readPageSignals(page.html, page.finalUrl, page.headers);
      hasNoindexDirective = signals.isNoindex;
      this.followLinks(entry, signals);
      markdownVariantUrl = await this.probeMarkdownVariant(page.finalUrl);
    }
    this.emittedUrls.push(entry.url);
    await this.options.onPage({
      normalisedUrl: entry.url,
      fetchUrl: entry.fetchUrl,
      finalUrl: page.finalUrl,
      httpStatusCode: page.httpStatusCode,
      headers: page.headers,
      html: page.html,
      fetchMethod: page.fetchMethod,
      crawlSignals: { crawlDepth: entry.crawlDepth, discoveredVia: entry.discoveredVia, hasNoindexDirective },
      markdownVariantUrl,
      sitemapLastModified: entry.sitemapLastModified,
    });
  }

  /**
   * A known page whose sitemap <lastmod> is the same as last time, on a site whose
   * lastmod has proved reliable. The homepage is always fetched: navigation comes from it.
   */
  private isUnchangedPerSitemap(entry: FrontierEntry): boolean {
    if (this.options.sitemapLastModifiedIsTrusted !== true || entry.crawlDepth === 0) return false;
    const stored = this.knownPages.get(entry.url)?.sitemapLastModifiedAt ?? null;
    if (stored === null || entry.sitemapLastModified === null) return false;
    const storedTime = Date.parse(stored);
    return !Number.isNaN(storedTime) && storedTime === Date.parse(entry.sitemapLastModified);
  }

  /**
   * Validators for a conditional GET of a known page. Not for the homepage, whose links
   * discovery needs; a 304 has no body to read them from.
   */
  private conditionalRequestHeaders(entry: FrontierEntry): Pick<FetchRequest, 'ifNoneMatch' | 'ifModifiedSince'> {
    const knownPage = this.knownPages.get(entry.url);
    if (knownPage === undefined || entry.crawlDepth === 0) return {};
    return {
      ...(knownPage.httpEtag !== null && { ifNoneMatch: knownPage.httpEtag }),
      ...(knownPage.httpLastModified !== null && { ifModifiedSince: knownPage.httpLastModified }),
    };
  }

  /** Fetches one page the way the site needs. Null when there is nothing to keep. */
  private async fetchPage(entry: FrontierEntry): Promise<FetchedPage | null> {
    if (this.requiresHeadlessRendering === true) return this.renderPage(entry.fetchUrl);

    const outcome = await this.politeFetch({
      url: entry.fetchUrl,
      acceptedContentTypes: HTML_TYPES,
      isRedirectAllowed: this.isRedirectAllowed,
      ...this.conditionalRequestHeaders(entry),
    });
    if (outcome.kind === 'failed') {
      // Not an HTML page, or a redirect into a disallowed path: not part of the site's
      // llms.txt, and not a failure of the site either.
      if (outcome.reason === 'unsupported_content_type' || outcome.reason === 'disallowed_by_robots') return null;
      this.recordFailure(entry.fetchUrl, outcome.reason, outcome.message);
      return null;
    }
    if (this.recordErrorStatus(entry.fetchUrl, outcome.httpStatusCode)) return null;

    const plainPage: FetchedPage = {
      finalUrl: outcome.finalUrl,
      httpStatusCode: outcome.httpStatusCode,
      headers: outcome.headers,
      html: outcome.body,
      fetchMethod: 'plain_http',
    };
    if (outcome.httpStatusCode < 200 || outcome.httpStatusCode >= 300) return plainPage;

    const plainSignals = readPageSignals(outcome.body, outcome.finalUrl, outcome.headers);
    if (!plainSignals.hasScripts) {
      // Without scripts, rendering cannot add anything.
      this.requiresHeadlessRendering ??= false;
      return plainPage;
    }

    if (this.requiresHeadlessRendering === null) {
      // The first page fetched is the homepage: compare the two ways once, for the site.
      const renderedPage = await this.renderPage(entry.fetchUrl, { recordFailure: false });
      if (renderedPage === null) {
        this.requiresHeadlessRendering = false;
        return plainPage;
      }
      const renderedSignals = readPageSignals(renderedPage.html, renderedPage.finalUrl, renderedPage.headers);
      this.requiresHeadlessRendering = renderingAddsContent(plainSignals, renderedSignals);
      return this.requiresHeadlessRendering ? renderedPage : plainPage;
    }

    // The per-page safety net on a site that is otherwise server-rendered.
    if (looksLikeJavaScriptShell(plainSignals)) {
      const renderedPage = await this.renderPage(entry.fetchUrl, { recordFailure: false });
      if (renderedPage === null) return plainPage;
      return renderedPageIsBetter(plainSignals, readPageSignals(renderedPage.html, renderedPage.finalUrl, renderedPage.headers))
        ? renderedPage
        : plainPage;
    }
    return plainPage;
  }

  private async renderPage(url: string, { recordFailure = true } = {}): Promise<FetchedPage | null> {
    this.renderer ??= new HeadlessRenderer({
      networkPolicy: this.options.networkPolicy,
      resolveHostname: this.options.resolveHostname,
    });
    await this.waitForRequestSlot();
    // The browser's requests to this host obey robots.txt too, as a crawler's should.
    const outcome = await this.renderer.render(url, { isUrlAllowed: this.isRedirectAllowed });
    if (outcome.kind === 'failed') {
      if (recordFailure && outcome.reason !== 'disallowed_by_robots') this.recordFailure(url, outcome.reason, outcome.message);
      return null;
    }
    if (isErrorStatus(outcome.httpStatusCode)) {
      if (recordFailure) this.recordErrorStatus(url, outcome.httpStatusCode);
      return null;
    }
    return {
      finalUrl: outcome.finalUrl,
      httpStatusCode: outcome.httpStatusCode,
      headers: outcome.headers,
      html: outcome.html,
      fetchMethod: 'headless_browser',
    };
  }

  private followLinks(entry: FrontierEntry, signals: PageSignals): void {
    const isHomepage = entry.crawlDepth === 0;

    if (isHomepage) {
      for (const navigationLink of signals.navigationLinkUrls) {
        const url = normaliseUrl(navigationLink);
        if (url === null || !isInScope(url, this.rootUrl)) continue;
        this.navigationUrls.add(url);
        this.addToFrontier(navigationLink, 1, 'navigation', null);
      }
    }
    if (signals.isNofollow) return;

    const sourceUrl = entry.url;
    for (const link of signals.linkUrls) {
      const url = normaliseUrl(link);
      if (url === null || url === sourceUrl) continue;
      if (!isInScope(url, this.rootUrl)) continue;
      let sources = this.inboundLinkSources.get(url);
      if (sources === undefined) this.inboundLinkSources.set(url, (sources = new Set()));
      sources.add(sourceUrl);
      this.addToFrontier(link, entry.crawlDepth + 1, 'page_link', null);
    }
  }

  /**
   * The spec's clean markdown version: the URL with .md appended, or index.html.md for
   * a URL without a file name. Probing stops after a few misses on a site with none.
   */
  private async probeMarkdownVariant(pageUrl: string): Promise<string | null> {
    if (!this.markdownVariantsFound && this.markdownProbeMisses >= MARKDOWN_PROBES_BEFORE_GIVING_UP) return null;
    const markdownUrl = markdownVariantUrlFor(pageUrl);
    if (markdownUrl === null || !this.isAllowedByRobots(markdownUrl)) return null;

    const outcome = await this.politeFetch({ url: markdownUrl, acceptedContentTypes: TEXT_TYPES });
    const found = outcome.kind === 'response' && outcome.httpStatusCode === 200 && outcome.contentType !== null;
    if (found) this.markdownVariantsFound = true;
    else this.markdownProbeMisses += 1;
    return found ? outcome.finalUrl : null;
  }

  /**
   * A fetch that waits its turn, and retries once when the server asks it to come back
   * later: a 429, or a 503 with Retry-After (RFC 9110, sections 10.2.3 and 15.6.4).
   */
  private async politeFetch(fetchRequest: FetchRequest): Promise<FetchOutcome> {
    await this.waitForRequestSlot();
    const outcome = await this.fetcher.fetch(fetchRequest);
    if (outcome.kind !== 'response') return outcome;
    const asksToRetry =
      outcome.httpStatusCode === 429 || (outcome.httpStatusCode === 503 && outcome.headers['retry-after'] !== undefined);
    if (!asksToRetry) return outcome;

    const retryAfterMs = parseRetryAfter(outcome.headers['retry-after']);
    if (retryAfterMs === null || retryAfterMs > (this.options.maxRetryAfterMs ?? 30_000)) return outcome;
    // Slow down for the rest of the crawl too.
    this.requestIntervalMs = Math.max(this.requestIntervalMs, Math.min(retryAfterMs, 10_000));
    await sleep(retryAfterMs);
    this.lastRequestAt = Date.now();
    return this.fetcher.fetch(fetchRequest);
  }

  private async waitForRequestSlot(): Promise<void> {
    const waitMs = this.lastRequestAt + this.requestIntervalMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    this.lastRequestAt = Date.now();
  }

  private recordFailure(url: string, reason: CrawlFailureReason, message: string, httpStatusCode: number | null = null): void {
    this.failedFetches.push({ url, reason, httpStatusCode, message });
  }

  /** Records a 5xx or 429 as a failed fetch. Returns whether it was one. */
  private recordErrorStatus(url: string, httpStatusCode: number): boolean {
    if (!isErrorStatus(httpStatusCode)) return false;
    const reason = httpStatusCode === 429 ? 'rate_limited' : 'server_error';
    this.recordFailure(url, reason, `HTTP ${httpStatusCode}`, httpStatusCode);
    return true;
  }

  private reportProgress(): void {
    this.options.onProgress?.({
      pagesDiscovered: this.frontier.size,
      pagesFetched: this.emittedUrls.length,
      pagesFailed: this.failedFetches.length,
    });
  }

  private linkSignalsFor(url: string): LinkSignals {
    return {
      isInSiteNavigation: this.navigationUrls.has(url),
      inboundLinkCount: this.inboundLinkSources.get(url)?.size ?? 0,
    };
  }
}

/** A response that says the site is struggling, not that the page is gone. */
function isErrorStatus(httpStatusCode: number): boolean {
  return httpStatusCode >= 500 || httpStatusCode === 429;
}

function compareEntries(a: FrontierEntry, b: FrontierEntry): number {
  return (
    a.crawlDepth - b.crawlDepth ||
    SOURCE_PRIORITY[a.discoveredVia] - SOURCE_PRIORITY[b.discoveredVia] ||
    a.order - b.order
  );
}

export function markdownVariantUrlFor(pageUrl: string): string | null {
  const url = new URL(pageUrl);
  if (url.search !== '' || url.pathname.endsWith('.md')) return null;
  const lastSegment = url.pathname.split('/').pop() ?? '';
  url.pathname = lastSegment === '' ? `${url.pathname.replace(/\/$/, '')}/index.html.md` : `${url.pathname}.md`;
  return url.href;
}

/** An llms.txt usually links .md variants; the page to crawl is the HTML they come from. */
export function htmlUrlForMarkdownLink(href: string, llmsTxtUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(href, llmsTxtUrl);
  } catch {
    return null;
  }
  if (url.pathname.endsWith('/index.html.md')) url.pathname = url.pathname.slice(0, -'index.html.md'.length);
  else if (url.pathname.endsWith('.md')) url.pathname = url.pathname.slice(0, -'.md'.length);
  return url.href;
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. Null if absent or unreadable. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
