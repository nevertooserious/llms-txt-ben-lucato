import {
  machineReadableResourceKindOf,
  type CrawlFailure,
  type CrawlFailureReason,
  type CrawlResult,
  type CrawlStopReason,
  type DiscoverySource,
  type FetchMethod,
  type KnownPage,
  type LinkSignals,
  type RawPage,
} from '@llms-txt/contracts';
import { looksLikeBotChallenge } from '../page-signals/detect-bot-challenge';
import { HeadlessRenderer } from '../network/headless-renderer';
import { HttpFetcher, type FetchOutcome, type FetchRequest } from '../network/http-fetcher';
import { cleanUrlForFetch, isInScope, isOnRelatedHost, normaliseUrl } from '../discovery/normalise-url';
import { parseSitemap } from '../discovery/parse-sitemap';
import { computeLinkGraphSignals } from './link-graph';
import { readPageSignals, type PageSignals } from '../page-signals/read-page-signals';
import { looksLikeJavaScriptShell, renderedPageIsBetter, renderingAddsContent } from '../page-signals/render-decision';
import {
  parseRobotsTxt,
  ROBOTS_TXT_MAX_PARSED_BYTES,
  robotsTxtUnavailable,
  robotsTxtUnreachable,
  type RobotsRules,
} from '../discovery/robots-rules';
import type { HostnameResolver, NetworkPolicy } from '../network/ssrf-guard';

export interface CrawlSiteOptions {
  /** sites.root_url: scheme, host and optional path prefix. */
  rootUrl: string;
  /** Most pages to fetch. Discovery requests (robots.txt, sitemaps, llms.txt, .md probes, machine-readable files) do not count. */
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
  /**
   * sites.machine_readable_resource_urls from earlier crawls. Each is checked again, so a
   * file found through a page that answers 304 this time is not lost with the link to it.
   */
  knownMachineReadableResourceUrls?: readonly string[];
}

export interface CrawlProgress {
  pagesDiscovered: number;
  pagesFetched: number;
  pagesFailed: number;
}

export type { CrawlResult };

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
/**
 * Pages on the site's other hosts that the navigation may add per crawl. Each is one
 * page; its links are not followed. Stored pages on those hosts are re-checked besides.
 */
const MAX_RELATED_HOST_PAGES = 15;
/** Most machine-readable files (llms-full.txt, a section's llms.txt, an OpenAPI description) requested per crawl. */
const MAX_MACHINE_READABLE_RESOURCE_CHECKS = 20;
/** Enough to learn that such a file is there; its content is not read. */
const MACHINE_READABLE_RESOURCE_BYTES_READ = 64 * 1024;

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
  /**
   * On another host of the same site (docs.example.com), which the homepage navigation
   * links. Fetched as one page under that host's robots.txt; its links are not followed.
   */
  isOnRelatedHost: boolean;
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
  /** The links of each page read in this crawl, in page order. */
  private readonly outboundLinksRead = new Map<string, string[]>();
  /** Pages that only forward with a meta refresh, and where to. */
  private readonly metaRefreshTargets = new Map<string, string>();
  /** Known pages that answered 304 or 404/410, which decide whether their stored links count. */
  private readonly notModifiedUrls = new Set<string>();
  private readonly notFoundUrls = new Set<string>();
  private homepageWasRead = false;
  /** The first homepage navigation link to each URL: its text and where it comes among them. */
  private readonly navigationLinks = new Map<string, { label: string | null; position: number }>();
  /** robots.txt rules of the site's other hosts, by origin, loaded when first needed. */
  private readonly relatedHostRobots = new Map<string, RobotsRules>();
  /** The related-host URLs the homepage navigation links, up to MAX_RELATED_HOST_PAGES. */
  private readonly relatedHostNavigationUrls = new Set<string>();
  private readonly knownPages = new Map<string, KnownPage>();
  /** URLs that name a machine-readable file, known ones first, to be requested once the pages are read. */
  private readonly machineReadableResourceCandidateUrls = new Set<string>();
  private machineReadableResourceUrls: string[] | null = null;
  /** Normalised URLs of the pages passed to onPage, in order. */
  private readonly emittedUrls: string[] = [];
  private readonly unchangedPerSitemapUrls: string[] = [];
  private readonly failedFetches: CrawlFailure[] = [];
  private pagesWithContentCount = 0;
  private markdownProbeMisses = 0;
  private markdownVariantsFound = false;
  private insertionOrder = 0;
  private readonly fetchRootUrl: string;
  private readonly deadline: number;
  /** robots.txt disallows the homepage or a redirect on the way to it. */
  private homepageIsDisallowedByRobots = false;

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
    for (const url of options.knownMachineReadableResourceUrls ?? []) this.addMachineReadableResourceCandidate(url);
    this.addMachineReadableResourceCandidate(`${this.rootUrl}/llms-full.txt`);
  }

  async run(): Promise<CrawlResult> {
    const decidedBefore = this.requiresHeadlessRendering !== null;
    let stopReason: CrawlStopReason;
    try {
      stopReason = await this.crawlUntilStopped();
    } catch (error) {
      if (!(error instanceof CrawlDeadlineReached)) throw error;
      stopReason = 'time_limit';
    }
    if (stopReason !== 'time_limit' && stopReason !== 'robots_txt_unreachable') {
      this.machineReadableResourceUrls = await this.findMachineReadableResources();
    }
    return this.result(stopReason, decidedBefore);
  }

  private async crawlUntilStopped(): Promise<CrawlStopReason> {
    await this.loadRobotsTxt();
    if (this.robots.status === 'unreachable') return 'robots_txt_unreachable';

    if (!this.addToFrontier(this.fetchRootUrl, 0, 'navigation', null)) this.homepageIsDisallowedByRobots = true;
    await this.seedFromSitemaps();
    await this.seedFromExistingLlmsTxt();
    this.seedFromKnownPages();

    for (;;) {
      if (this.emittedUrls.length >= this.options.pageBudget) return 'page_budget';
      if (this.fetchedUrls.size >= this.options.pageBudget * ATTEMPTS_PER_BUDGETED_PAGE) return 'attempt_limit';
      if (Date.now() >= this.deadline) return 'time_limit';
      const entry = this.takeNextFromFrontier();
      if (entry === undefined) return 'frontier_exhausted';
      await this.crawlPage(entry);
      this.reportProgress();
    }
  }

  private result(stopReason: CrawlStopReason, decidedBefore: boolean): CrawlResult {
    return {
      robotsTxtStatus: this.robots.status,
      // Said only when nothing else was fetched either: it is then why the run has no pages.
      stopReason: this.homepageIsDisallowedByRobots && this.emittedUrls.length === 0 ? 'homepage_disallowed_by_robots' : stopReason,
      pagesFetchedCount: this.emittedUrls.length,
      pagesWithContentCount: this.pagesWithContentCount,
      linkSignals: this.finalLinkSignals(),
      unchangedPerSitemapUrls: this.unchangedPerSitemapUrls,
      failedFetches: this.failedFetches,
      requiresHeadlessRendering: this.requiresHeadlessRendering ?? false,
      decidedHeadlessRendering: !decidedBefore && this.requiresHeadlessRendering !== null,
      machineReadableResourceUrls: this.machineReadableResourceUrls,
    };
  }

  async close(): Promise<void> {
    await this.fetcher.close();
    if (this.ownsRenderer) await this.renderer?.close();
  }

  // --- discovery -------------------------------------------------------------------

  /** RFC 9309, section 2.3.1. See robots-rules.ts for the table. */
  private async loadRobotsTxt(): Promise<void> {
    this.robots = await this.fetchRobotsTxt(this.rootUrl, { recordFailures: true });
    if (this.robots.crawlDelaySeconds !== null) {
      this.requestIntervalMs = Math.max(this.requestIntervalMs, this.robots.crawlDelaySeconds * 1000);
    }
  }

  private async fetchRobotsTxt(hostUrl: string, { recordFailures }: { recordFailures: boolean }): Promise<RobotsRules> {
    const robotsTxtUrl = new URL('/robots.txt', hostUrl).href;
    const outcome = await this.politeFetch({
      url: robotsTxtUrl,
      // Parsed whatever its media type; only the first 500 KiB need be read.
      acceptedContentTypes: ['*/*'],
      maxResponseBytes: ROBOTS_TXT_MAX_PARSED_BYTES,
      truncateAtMaxBytes: true,
    });

    if (outcome.kind === 'failed') {
      const isUnavailable = ['too_many_redirects', 'invalid_url', 'unsupported_scheme'].includes(outcome.reason);
      if (!isUnavailable && recordFailures) this.recordFailure(robotsTxtUrl, 'robots_txt_unreachable', outcome.message);
      return isUnavailable ? robotsTxtUnavailable : robotsTxtUnreachable;
    }
    const status = outcome.httpStatusCode;
    // Keyed on the requested URL: rules reached through a redirect still govern this host (RFC 9309, 2.3.1.2).
    if (status >= 200 && status < 300) return parseRobotsTxt(robotsTxtUrl, outcome.body);
    if (status >= 500) {
      if (recordFailures) this.recordFailure(robotsTxtUrl, 'robots_txt_unreachable', `HTTP ${status}`, status);
      return robotsTxtUnreachable;
    }
    return robotsTxtUnavailable;
  }

  /**
   * The robots.txt rules of another host of the site, fetched once per crawl. A host
   * whose robots.txt cannot be reached is left alone; that is not a failure of the site.
   */
  private async isAllowedOnRelatedHost(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    let rules = this.relatedHostRobots.get(origin);
    if (rules === undefined) {
      rules = await this.fetchRobotsTxt(origin, { recordFailures: false });
      this.relatedHostRobots.set(origin, rules);
    }
    return rules.isAllowed(url);
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
        ...(!listedInRobotsTxt && { isRedirectAllowed: this.isRedirectAllowed }),
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
      const outcome = await this.politeFetch({
        url: llmsTxtUrl,
        acceptedContentTypes: TEXT_TYPES,
        isRedirectAllowed: this.isRedirectAllowed,
      });
      if (outcome.kind !== 'response' || outcome.httpStatusCode !== 200) continue;
      for (const match of outcome.body.matchAll(/\]\(\s*<?([^)\s>]+)>?\s*\)/g)) {
        if (this.addMachineReadableResourceCandidate(match[1]!, outcome.finalUrl)) continue;
        const linkedUrl = htmlUrlForMarkdownLink(match[1]!, outcome.finalUrl);
        if (linkedUrl !== null) this.addToFrontier(linkedUrl, 1, 'existing_llms_txt', null);
      }
      return;
    }
  }

  /**
   * Notes a link to one of the site's machine-readable files; returns whether it was one.
   * The llms.txt at the site's root is not: the generated file stands in for it.
   */
  private addMachineReadableResourceCandidate(href: string, baseUrl?: string): boolean {
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return false;
    }
    url.hash = '';
    if (machineReadableResourceKindOf(url.href) === null || !isInScope(url.href, this.rootUrl)) return false;
    if (url.href === `${this.rootUrl}/llms.txt` || url.href === new URL('/llms.txt', this.rootUrl).href) return false;
    this.machineReadableResourceCandidateUrls.add(url.href);
    return true;
  }

  /**
   * Requests each candidate and keeps those that are there: a 200 that is not an HTML
   * page, since a site that answers every path with its app shell has no such file.
   * Null when a candidate answered with an error or the time ran out, which says nothing
   * about whether the file exists.
   */
  private async findMachineReadableResources(): Promise<string[] | null> {
    const found: string[] = [];
    const candidates = [...this.machineReadableResourceCandidateUrls].slice(0, MAX_MACHINE_READABLE_RESOURCE_CHECKS);
    for (const url of candidates) {
      if (!this.isAllowedByRobots(url)) continue;
      let outcome: FetchOutcome;
      try {
        outcome = await this.politeFetch({
          url,
          acceptedContentTypes: ['*/*'],
          maxResponseBytes: MACHINE_READABLE_RESOURCE_BYTES_READ,
          truncateAtMaxBytes: true,
          isRedirectAllowed: this.isRedirectAllowed,
        });
      } catch (error) {
        if (error instanceof CrawlDeadlineReached) return null;
        throw error;
      }
      if (outcome.kind === 'failed') {
        if (outcome.reason === 'timeout' || outcome.reason === 'network_error') return null;
        continue;
      }
      if (isErrorStatus(outcome.httpStatusCode)) return null;
      const isFile = outcome.contentType !== null && !HTML_TYPES.includes(outcome.contentType);
      if (outcome.httpStatusCode === 200 && isFile && isInScope(outcome.finalUrl, this.rootUrl)) found.push(url);
    }
    return found;
  }

  /**
   * Known pages go in after discovery, so a URL discovery found keeps the form the site
   * links today. Scope and robots.txt apply to them as to any other URL.
   */
  private seedFromKnownPages(): void {
    for (const knownPage of this.knownPages.values()) {
      // A stored page on a related host is re-checked even if the navigation dropped it.
      this.addToFrontier(knownPage.fetchUrl, knownPage.crawlDepth, knownPage.discoveredVia, null, {
        allowRelatedHost: true,
      });
    }
    // The links of a page that answers 304 are not read again, so they are queued here.
    for (const knownPage of this.knownPages.values()) {
      if (knownPage.isRemoved) continue;
      for (const link of knownPage.outboundLinkUrls ?? []) {
        this.addToFrontier(link, knownPage.crawlDepth + 1, 'page_link', null);
      }
    }
  }

  /** robots.txt rules for a URL on this site's host. robots.txt itself is always allowed. */
  private isAllowedByRobots(url: string): boolean {
    return this.robots.isAllowed(url);
  }

  /**
   * For redirect targets. Rules on this host are checked, and those of a related host
   * whose robots.txt has been loaded. No other host's robots.txt is fetched, and a
   * target off the site is out of scope and dropped after the fetch.
   */
  private isRedirectAllowed = (url: string): boolean => {
    const target = new URL(url);
    if (target.host === new URL(this.rootUrl).host) return this.isAllowedByRobots(url);
    return this.relatedHostRobots.get(target.origin)?.isAllowed(url) ?? true;
  };

  /**
   * Adds an in-scope, allowed URL; returns true if it was new. With `allowRelatedHost`,
   * a URL on another host of the site is added too; its robots.txt is checked when it
   * is fetched.
   */
  private addToFrontier(
    rawUrl: string,
    crawlDepth: number,
    discoveredVia: DiscoverySource,
    sitemapLastModified: string | null,
    { allowRelatedHost = false } = {},
  ): boolean {
    const url = normaliseUrl(rawUrl);
    const fetchUrl = cleanUrlForFetch(rawUrl);
    if (url === null || fetchUrl === null) return false;
    const isRelated = !isInScope(url, this.rootUrl);
    if (isRelated && !(allowRelatedHost && isOnRelatedHost(url, this.rootUrl))) return false;
    if (!isRelated && !this.isAllowedByRobots(fetchUrl)) return false;

    const existing = this.frontier.get(url);
    if (existing !== undefined) {
      existing.crawlDepth = Math.min(existing.crawlDepth, crawlDepth);
      existing.sitemapLastModified ??= sitemapLastModified;
      // A page the sitemap listed first is still a navigation page once the homepage links
      // it, and must not wait behind the rest of the sitemap.
      if (this.pending.has(url) && SOURCE_PRIORITY[discoveredVia] < SOURCE_PRIORITY[existing.discoveredVia]) {
        existing.discoveredVia = discoveredVia;
      }
      return false;
    }
    this.frontier.set(url, {
      url,
      fetchUrl,
      crawlDepth,
      discoveredVia,
      sitemapLastModified,
      order: this.insertionOrder++,
      isOnRelatedHost: isRelated,
    });
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
    if (entry.isOnRelatedHost && !(await this.isAllowedOnRelatedHost(entry.fetchUrl))) return;

    const page = await this.fetchPage(entry);
    if (page === null) return;

    // A redirect elsewhere in scope lands on a URL that may also be in the frontier.
    const finalUrl = normaliseUrl(page.finalUrl);
    if (finalUrl === null) return;
    if (entry.isOnRelatedHost) {
      // A related host that only redirects into the site (example.com to www.example.com)
      // is that page of the site, crawled as any other.
      if (isInScope(finalUrl, this.rootUrl)) {
        this.addToFrontier(page.finalUrl, entry.crawlDepth, entry.discoveredVia, null);
        return;
      }
      if (!isOnRelatedHost(finalUrl, this.rootUrl)) return;
    } else if (!isInScope(finalUrl, this.rootUrl)) return;
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
      if (this.followMetaRefresh(entry, finalUrl, signals)) return;
      hasNoindexDirective = signals.isNoindex;
      if (entry.isOnRelatedHost) {
        // Its links are not followed: an empty list, so it can still answer 304 next time.
        this.outboundLinksRead.set(entry.url, []);
      } else {
        this.followLinks(entry, signals);
        markdownVariantUrl = await this.probeMarkdownVariant(page.finalUrl);
      }
    } else if (page.httpStatusCode === 304) {
      this.notModifiedUrls.add(entry.url);
    } else if (page.httpStatusCode === 404 || page.httpStatusCode === 410) {
      this.notFoundUrls.add(entry.url);
    }
    this.emittedUrls.push(entry.url);
    if (isSuccess || page.httpStatusCode === 304) this.pagesWithContentCount += 1;
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
      outboundLinkUrls: this.outboundLinksRead.get(entry.url) ?? null,
    });
  }

  /**
   * A known page whose sitemap <lastmod> is the same as last time, on a site whose
   * lastmod has proved reliable. The homepage is always fetched: navigation comes from it.
   * So is a page with no stored links, which has to be read once to have them.
   */
  private isUnchangedPerSitemap(entry: FrontierEntry): boolean {
    if (this.options.sitemapLastModifiedIsTrusted !== true || entry.crawlDepth === 0) return false;
    const knownPage = this.knownPages.get(entry.url);
    if (knownPage?.outboundLinkUrls === null) return false;
    const stored = knownPage?.sitemapLastModifiedAt ?? null;
    if (stored === null || entry.sitemapLastModified === null) return false;
    const storedTime = Date.parse(stored);
    return !Number.isNaN(storedTime) && storedTime === Date.parse(entry.sitemapLastModified);
  }

  /**
   * Validators for a conditional GET of a known page. Not for the homepage, whose links
   * discovery needs, or a page with no stored links; a 304 has no body to read them from.
   */
  private conditionalRequestHeaders(entry: FrontierEntry): Pick<FetchRequest, 'ifNoneMatch' | 'ifModifiedSince'> {
    const knownPage = this.knownPages.get(entry.url);
    if (knownPage === undefined || knownPage.outboundLinkUrls === null || entry.crawlDepth === 0) return {};
    return {
      ...(knownPage.httpEtag !== null && { ifNoneMatch: knownPage.httpEtag }),
      ...(knownPage.httpLastModified !== null && { ifModifiedSince: knownPage.httpLastModified }),
    };
  }

  /** Fetches one page the way the site needs. Null when there is nothing to keep. */
  private async fetchPage(entry: FrontierEntry): Promise<FetchedPage | null> {
    if (this.requiresHeadlessRendering === true) {
      return this.renderPage(entry.fetchUrl, { isHomepage: entry.crawlDepth === 0 });
    }

    const outcome = await this.politeFetch({
      url: entry.fetchUrl,
      acceptedContentTypes: HTML_TYPES,
      isRedirectAllowed: this.isRedirectAllowed,
      ...this.conditionalRequestHeaders(entry),
    });
    if (outcome.kind === 'failed') {
      // Not an HTML page, or a redirect into a disallowed path: not part of the site's
      // llms.txt, and not a failure of the site either.
      if (outcome.reason === 'disallowed_by_robots' && entry.crawlDepth === 0) this.homepageIsDisallowedByRobots = true;
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
    if (looksLikeBotChallenge(outcome.body, outcome.headers)) {
      this.recordFailure(entry.fetchUrl, 'bot_challenge', 'The response was a bot-challenge page.', outcome.httpStatusCode);
      return null;
    }

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
      this.requiresHeadlessRendering = renderingAddsContent(plainSignals, renderedSignals, (url) => isInScope(url, this.rootUrl));
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

  private async renderPage(url: string, { recordFailure = true, isHomepage = false } = {}): Promise<FetchedPage | null> {
    this.renderer ??= new HeadlessRenderer({
      networkPolicy: this.options.networkPolicy,
      resolveHostname: this.options.resolveHostname,
    });
    await this.waitForRequestSlot();
    // The browser's requests to this host obey robots.txt too, as a crawler's should.
    const outcome = await this.renderer.render(url, { isUrlAllowed: this.isRedirectAllowed });
    if (outcome.kind === 'failed') {
      if (isHomepage && outcome.reason === 'disallowed_by_robots') this.homepageIsDisallowedByRobots = true;
      if (recordFailure && outcome.reason !== 'disallowed_by_robots' && outcome.reason !== 'unsupported_content_type') {
        this.recordFailure(url, outcome.reason, outcome.message);
      }
      return null;
    }
    if (isErrorStatus(outcome.httpStatusCode)) {
      if (recordFailure) this.recordErrorStatus(url, outcome.httpStatusCode);
      return null;
    }
    if (outcome.httpStatusCode >= 200 && outcome.httpStatusCode < 300 && looksLikeBotChallenge(outcome.html, outcome.headers)) {
      if (recordFailure) this.recordFailure(url, 'bot_challenge', 'The rendered page was a bot-challenge page.', outcome.httpStatusCode);
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

  /**
   * A page that only sends the reader on with `<meta http-equiv="refresh">` is a redirect
   * written in HTML. Its target is queued in its place, keeping its depth and its place
   * in the navigation, and the page itself is not passed on. Returns whether it was one.
   * The homepage is never treated so: discovery starts from its links.
   */
  private followMetaRefresh(entry: FrontierEntry, finalUrl: string, signals: PageSignals): boolean {
    if (entry.crawlDepth === 0 || signals.metaRefreshUrl === null) return false;
    const targetUrl = normaliseUrl(signals.metaRefreshUrl);
    if (targetUrl === null || targetUrl === entry.url || targetUrl === finalUrl) return false;

    this.addToFrontier(signals.metaRefreshUrl, entry.crawlDepth, entry.discoveredVia, null, {
      allowRelatedHost: entry.isOnRelatedHost,
    });
    if (this.frontier.has(targetUrl)) {
      const navigationLink = this.navigationLinks.get(entry.url);
      if (navigationLink !== undefined && !this.navigationLinks.has(targetUrl)) {
        this.navigationLinks.set(targetUrl, navigationLink);
      }
      this.metaRefreshTargets.set(entry.url, targetUrl);
    }
    return true;
  }

  private followLinks(entry: FrontierEntry, signals: PageSignals): void {
    const isHomepage = entry.crawlDepth === 0;
    const outboundLinks = new Set<string>();
    this.outboundLinksRead.set(entry.url, []);

    if (isHomepage) {
      this.homepageWasRead = true;
      for (const [position, navigationLink] of signals.navigationLinks.entries()) {
        const url = normaliseUrl(navigationLink.url);
        if (url === null) continue;
        if (isInScope(url, this.rootUrl)) {
          // Membership is a fact about the page; nofollow only forbids following the link.
          if (!signals.isNofollow) this.addToFrontier(navigationLink.url, 1, 'navigation', null);
        } else {
          // The site's other hosts (docs.example.com), as far as its navigation names them.
          if (signals.isNofollow || !isOnRelatedHost(url, this.rootUrl)) continue;
          // Counted apart from stored pages, so the same links are taken on every crawl.
          if (!this.relatedHostNavigationUrls.has(url)) {
            if (this.relatedHostNavigationUrls.size >= MAX_RELATED_HOST_PAGES) continue;
            this.relatedHostNavigationUrls.add(url);
          }
          this.addToFrontier(navigationLink.url, 1, 'navigation', null, { allowRelatedHost: true });
          if (!this.frontier.has(url)) continue;
        }
        if (!this.navigationLinks.has(url)) this.navigationLinks.set(url, { label: navigationLink.label, position });
      }
    }
    if (signals.isNofollow) return;

    const sourceUrl = entry.url;
    for (const link of signals.linkUrls) {
      if (this.addMachineReadableResourceCandidate(link)) continue;
      const url = normaliseUrl(link);
      if (url === null || url === sourceUrl) continue;
      // Links to a related-host page count toward it, but only the navigation queues one.
      if (!isInScope(url, this.rootUrl) && this.frontier.get(url)?.isOnRelatedHost !== true) continue;
      outboundLinks.add(url);
      this.addToFrontier(link, entry.crawlDepth + 1, 'page_link', null);
    }
    this.outboundLinksRead.set(sourceUrl, [...outboundLinks]);
  }

  /**
   * The spec's clean markdown version: the URL with .md appended, or index.html.md for
   * a URL without a file name. Probing stops after a few misses on a site with none.
   */
  private async probeMarkdownVariant(pageUrl: string): Promise<string | null> {
    if (!this.markdownVariantsFound && this.markdownProbeMisses >= MARKDOWN_PROBES_BEFORE_GIVING_UP) return null;
    const markdownUrl = markdownVariantUrlFor(pageUrl);
    if (markdownUrl === null || !this.isAllowedByRobots(markdownUrl)) return null;

    const outcome = await this.politeFetch({
      url: markdownUrl,
      acceptedContentTypes: TEXT_TYPES,
      isRedirectAllowed: this.isRedirectAllowed,
    });
    const found =
      outcome.kind === 'response' &&
      outcome.httpStatusCode === 200 &&
      outcome.contentType !== null &&
      isInScope(outcome.finalUrl, this.rootUrl);
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
    if (Date.now() + retryAfterMs >= this.deadline) throw new CrawlDeadlineReached();
    // Slow down for the rest of the crawl too.
    this.requestIntervalMs = Math.max(this.requestIntervalMs, Math.min(retryAfterMs, 10_000));
    await sleep(retryAfterMs);
    this.lastRequestAt = Date.now();
    return this.fetcher.fetch(fetchRequest);
  }

  private async waitForRequestSlot(): Promise<void> {
    const waitMs = this.lastRequestAt + this.requestIntervalMs - Date.now();
    // Crawl-delay is honoured as given, so a slot past the time limit ends the crawl.
    if (waitMs > 0 && Date.now() + waitMs >= this.deadline) throw new CrawlDeadlineReached();
    if (waitMs > 0) await sleep(waitMs);
    this.lastRequestAt = Date.now();
  }

  private recordFailure(url: string, reason: CrawlFailureReason, message: string, httpStatusCode: number | null = null): void {
    this.failedFetches.push({ url, reason, httpStatusCode, message });
  }

  /** Records a 5xx, 429, 401, 403 or 451 as a failed fetch. Returns whether it was one. */
  private recordErrorStatus(url: string, httpStatusCode: number): boolean {
    if (!isErrorStatus(httpStatusCode)) return false;
    const reason = httpStatusCode === 429 ? 'rate_limited' : httpStatusCode >= 500 ? 'server_error' : 'blocked';
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

  /**
   * The site's links as they stand: what this crawl read, and the stored links of every
   * other known page. A page that was not reached or could not be fetched keeps its links;
   * one that answered 404/410, is removed, or now only forwards contributes none.
   */
  private currentLinksByPage(): Map<string, readonly string[]> {
    const linksByPage = new Map<string, readonly string[]>();
    for (const knownPage of this.knownPages.values()) {
      if (knownPage.outboundLinkUrls === null || this.notFoundUrls.has(knownPage.normalisedUrl)) continue;
      if (knownPage.isRemoved && !this.notModifiedUrls.has(knownPage.normalisedUrl)) continue;
      linksByPage.set(knownPage.normalisedUrl, knownPage.outboundLinkUrls);
    }
    for (const [url, links] of this.outboundLinksRead) linksByPage.set(url, links);
    for (const url of this.metaRefreshTargets.keys()) linksByPage.delete(url);
    return linksByPage;
  }

  /**
   * Navigation comes from the homepage, so without a read of it a page not fetched in this
   * crawl is left out and keeps the signals it has.
   */
  private finalLinkSignals(): Record<string, LinkSignals> {
    const graphSignals = computeLinkGraphSignals(this.rootUrl, this.currentLinksByPage(), this.metaRefreshTargets);
    const urls = new Set(this.emittedUrls);
    if (this.homepageWasRead) for (const url of this.knownPages.keys()) urls.add(url);
    return Object.fromEntries(
      [...urls].map((url) => [
        url,
        {
          isInSiteNavigation: this.navigationLinks.has(url),
          inboundLinkCount: graphSignals.get(url)?.inboundLinkCount ?? 0,
          navigationLabel: this.navigationLinks.get(url)?.label ?? null,
          navigationPosition: this.navigationLinks.get(url)?.position ?? null,
          firstLinkPosition: graphSignals.get(url)?.firstLinkPosition ?? null,
        },
      ]),
    );
  }
}

/** The next request could only be made after the crawl's time limit. */
class CrawlDeadlineReached extends Error {}

/** A response that says the site is struggling or refusing us, not that the page is gone. */
function isErrorStatus(httpStatusCode: number): boolean {
  return httpStatusCode >= 500 || [401, 403, 429, 451].includes(httpStatusCode);
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
  else if (url.pathname.endsWith('/index.md')) url.pathname = url.pathname.slice(0, -'index.md'.length);
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
