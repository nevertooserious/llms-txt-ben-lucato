import type { DiscoverySource, FetchMethod, RawPage } from '@llms-txt/contracts';
import { HeadlessRenderer } from './headless-renderer';
import { HttpFetcher, type FetchOutcome, type FetchRequest } from './http-fetcher';
import { isInScope, normaliseUrl } from './normalise-url';
import { parseSitemap } from './parse-sitemap';
import { readPageSignals, type PageSignals } from './read-page-signals';
import { looksLikeJavaScriptShell, renderedPageIsBetter, renderingAddsContent } from './render-decision';
import { allowEverything, parseRobotsTxt, type RobotsRules } from './robots-rules';
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
  /** Longest wait honoured for a 429's Retry-After before giving up on that URL. */
  maxRetryAfterMs?: number;
  /**
   * A renderer shared across crawls, so its concurrency limit is global to the worker.
   * When absent, the crawl makes its own and closes it at the end.
   */
  headlessRenderer?: HeadlessRenderer;
  /** Called as pages are discovered and fetched, to update pipeline_runs progress. */
  onProgress?: (progress: CrawlProgress) => void;
}

export interface CrawlProgress {
  pagesDiscovered: number;
  pagesFetched: number;
  pagesFailed: number;
}

export interface CrawlFailure {
  url: string;
  reason: string;
  message: string;
}

export interface CrawlResult {
  /** Every page that answered, including 404s and 410s, which the monitor needs. */
  pages: RawPage[];
  /** Pages that could not be fetched (timeouts, 5xx, blocks). They count toward the safety gate. */
  failedFetches: CrawlFailure[];
  /** For sites.requires_headless_rendering. */
  requiresHeadlessRendering: boolean;
  /** True when this crawl made the decision, so the caller can stamp when it was made. */
  decidedHeadlessRendering: boolean;
}

const HTML_TYPES = ['text/html', 'application/xhtml+xml'];
const SITEMAP_TYPES = ['application/xml', 'text/xml', 'text/plain'];
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
  url: string;
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
  private robots: RobotsRules = allowEverything;
  private requestIntervalMs: number;
  private lastRequestAt = 0;

  private requiresHeadlessRendering: boolean | null;
  private readonly frontier = new Map<string, FrontierEntry>();
  private readonly pending = new Set<string>();
  private readonly fetchedUrls = new Set<string>();
  private readonly inboundLinkSources = new Map<string, Set<string>>();
  private readonly navigationUrls = new Set<string>();
  private readonly results: Array<{ entry: FrontierEntry; page: FetchedPage; markdownVariantUrl: string | null }> = [];
  private readonly failedFetches: CrawlFailure[] = [];
  private markdownProbeMisses = 0;
  private markdownVariantsFound = false;
  private insertionOrder = 0;

  constructor(private readonly options: CrawlSiteOptions) {
    const rootUrl = normaliseUrl(options.rootUrl);
    if (rootUrl === null) throw new Error(`not a crawlable root URL: ${options.rootUrl}`);
    this.rootUrl = rootUrl;
    this.fetcher = new HttpFetcher({ networkPolicy: options.networkPolicy, resolveHostname: options.resolveHostname });
    this.renderer = options.headlessRenderer;
    this.ownsRenderer = options.headlessRenderer === undefined;
    this.requestIntervalMs = options.minRequestIntervalMs ?? 500;
    this.requiresHeadlessRendering = options.requiresHeadlessRendering ?? null;
  }

  async run(): Promise<CrawlResult> {
    const decidedBefore = this.requiresHeadlessRendering !== null;
    await this.loadRobotsTxt();
    this.addToFrontier(this.rootUrl, 0, 'navigation', null);
    await this.seedFromSitemaps();
    await this.seedFromExistingLlmsTxt();

    for (;;) {
      if (this.results.length >= this.options.pageBudget) break;
      if (this.fetchedUrls.size >= this.options.pageBudget * ATTEMPTS_PER_BUDGETED_PAGE) break;
      const entry = this.takeNextFromFrontier();
      if (entry === undefined) break;
      await this.crawlPage(entry);
      this.reportProgress();
    }

    return {
      pages: this.results.map(({ entry, page, markdownVariantUrl }) => this.toRawPage(entry, page, markdownVariantUrl)),
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

  private async loadRobotsTxt(): Promise<void> {
    const robotsTxtUrl = new URL('/robots.txt', this.rootUrl).href;
    const outcome = await this.politeFetch({ url: robotsTxtUrl, acceptedContentTypes: TEXT_TYPES });
    if (outcome.kind === 'response' && outcome.httpStatusCode === 200) {
      this.robots = parseRobotsTxt(robotsTxtUrl, outcome.body);
      if (this.robots.crawlDelaySeconds !== null) {
        this.requestIntervalMs = Math.max(this.requestIntervalMs, this.robots.crawlDelaySeconds * 1000);
      }
    }
  }

  private async seedFromSitemaps(): Promise<void> {
    const queue = this.robots.sitemapUrls.length > 0 ? [...this.robots.sitemapUrls] : [new URL('/sitemap.xml', this.rootUrl).href];
    const seen = new Set<string>();
    const maxEntries = this.options.pageBudget * SITEMAP_ENTRIES_PER_BUDGETED_PAGE;
    let entriesAdded = 0;

    while (queue.length > 0 && seen.size < MAX_SITEMAP_FETCHES && entriesAdded < maxEntries) {
      const sitemapUrl = queue.shift()!;
      if (seen.has(sitemapUrl)) continue;
      seen.add(sitemapUrl);
      const outcome = await this.politeFetch({ url: sitemapUrl, acceptedContentTypes: SITEMAP_TYPES });
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

  private async seedFromExistingLlmsTxt(): Promise<void> {
    const llmsTxtUrl = `${this.rootUrl}/llms.txt`;
    const outcome = await this.politeFetch({ url: llmsTxtUrl, acceptedContentTypes: TEXT_TYPES });
    if (outcome.kind !== 'response' || outcome.httpStatusCode !== 200) return;
    for (const match of outcome.body.matchAll(/\]\(\s*<?([^)\s>]+)>?\s*\)/g)) {
      const linkedUrl = htmlUrlForMarkdownLink(match[1]!, outcome.finalUrl);
      if (linkedUrl !== null) this.addToFrontier(linkedUrl, 1, 'existing_llms_txt', null);
    }
  }

  /** Adds an in-scope, allowed URL; returns true if it was new. */
  private addToFrontier(
    rawUrl: string,
    crawlDepth: number,
    discoveredVia: DiscoverySource,
    sitemapLastModified: string | null,
  ): boolean {
    const url = normaliseUrl(rawUrl);
    if (url === null || !isInScope(url, this.rootUrl) || !this.robots.isAllowed(url)) return false;

    const existing = this.frontier.get(url);
    if (existing !== undefined) {
      existing.crawlDepth = Math.min(existing.crawlDepth, crawlDepth);
      existing.sitemapLastModified ??= sitemapLastModified;
      return false;
    }
    this.frontier.set(url, { url, crawlDepth, discoveredVia, sitemapLastModified, order: this.insertionOrder++ });
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
    if (isSuccess) this.followLinks(entry, page);
    const markdownVariantUrl = isSuccess ? await this.probeMarkdownVariant(finalUrl) : null;
    this.results.push({ entry, page, markdownVariantUrl });
  }

  /** Fetches one page the way the site needs. Null when there is nothing to keep. */
  private async fetchPage(entry: FrontierEntry): Promise<FetchedPage | null> {
    if (this.requiresHeadlessRendering === true) return this.renderPage(entry.url);

    const outcome = await this.politeFetch({ url: entry.url, acceptedContentTypes: HTML_TYPES });
    if (outcome.kind === 'failed') {
      // Not an HTML page: not part of the site's llms.txt, and not a failure either.
      if (outcome.reason !== 'unsupported_content_type') this.recordFailure(entry.url, outcome.reason, outcome.message);
      return null;
    }
    if (outcome.httpStatusCode >= 500 || outcome.httpStatusCode === 429) {
      this.recordFailure(entry.url, `http_${outcome.httpStatusCode}`, `HTTP ${outcome.httpStatusCode}`);
      return null;
    }

    const plainPage: FetchedPage = {
      finalUrl: outcome.finalUrl,
      httpStatusCode: outcome.httpStatusCode,
      headers: outcome.headers,
      html: outcome.body,
      fetchMethod: 'plain_http',
    };
    if (outcome.httpStatusCode < 200 || outcome.httpStatusCode >= 300) return plainPage;

    const plainSignals = readPageSignals(outcome.body, outcome.finalUrl);
    if (!plainSignals.hasScripts) {
      // Without scripts, rendering cannot add anything.
      this.requiresHeadlessRendering ??= false;
      return plainPage;
    }

    if (this.requiresHeadlessRendering === null) {
      // The first page fetched is the homepage: compare the two ways once, for the site.
      const renderedPage = await this.renderPage(entry.url, { recordFailure: false });
      if (renderedPage === null) {
        this.requiresHeadlessRendering = false;
        return plainPage;
      }
      const renderedSignals = readPageSignals(renderedPage.html, renderedPage.finalUrl);
      this.requiresHeadlessRendering = renderingAddsContent(plainSignals, renderedSignals);
      return this.requiresHeadlessRendering ? renderedPage : plainPage;
    }

    // The per-page safety net on a site that is otherwise server-rendered.
    if (looksLikeJavaScriptShell(plainSignals)) {
      const renderedPage = await this.renderPage(entry.url, { recordFailure: false });
      if (renderedPage === null) return plainPage;
      return renderedPageIsBetter(plainSignals, readPageSignals(renderedPage.html, renderedPage.finalUrl))
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
    const outcome = await this.renderer.render(url);
    if (outcome.kind === 'failed') {
      if (recordFailure) this.recordFailure(url, outcome.reason, outcome.message);
      return null;
    }
    if (outcome.httpStatusCode >= 500 || outcome.httpStatusCode === 429) {
      if (recordFailure) this.recordFailure(url, `http_${outcome.httpStatusCode}`, `HTTP ${outcome.httpStatusCode}`);
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

  private followLinks(entry: FrontierEntry, page: FetchedPage): void {
    const signals: PageSignals = readPageSignals(page.html, page.finalUrl);
    const isHomepage = entry.crawlDepth === 0;

    if (isHomepage) {
      for (const navigationLink of signals.navigationLinkUrls) {
        const url = normaliseUrl(navigationLink);
        if (url === null || !isInScope(url, this.rootUrl)) continue;
        this.navigationUrls.add(url);
        this.addToFrontier(url, 1, 'navigation', null);
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
      this.addToFrontier(url, entry.crawlDepth + 1, 'page_link', null);
    }
  }

  /**
   * The spec's clean markdown version: the URL with .md appended, or index.html.md for
   * a URL without a file name. Probing stops after a few misses on a site with none.
   */
  private async probeMarkdownVariant(pageUrl: string): Promise<string | null> {
    if (!this.markdownVariantsFound && this.markdownProbeMisses >= MARKDOWN_PROBES_BEFORE_GIVING_UP) return null;
    const markdownUrl = markdownVariantUrlFor(pageUrl);
    if (markdownUrl === null || !this.robots.isAllowed(markdownUrl)) return null;

    const outcome = await this.politeFetch({ url: markdownUrl, acceptedContentTypes: TEXT_TYPES });
    const found = outcome.kind === 'response' && outcome.httpStatusCode === 200 && outcome.contentType !== null;
    if (found) this.markdownVariantsFound = true;
    else this.markdownProbeMisses += 1;
    return found ? outcome.finalUrl : null;
  }

  /** A fetch that waits its turn, and retries once after a 429 if Retry-After allows. */
  private async politeFetch(fetchRequest: FetchRequest): Promise<FetchOutcome> {
    await this.waitForRequestSlot();
    const outcome = await this.fetcher.fetch(fetchRequest);
    if (outcome.kind !== 'response' || outcome.httpStatusCode !== 429) return outcome;

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

  private recordFailure(url: string, reason: string, message: string): void {
    this.failedFetches.push({ url, reason, message });
  }

  private reportProgress(): void {
    this.options.onProgress?.({
      pagesDiscovered: this.frontier.size,
      pagesFetched: this.results.length,
      pagesFailed: this.failedFetches.length,
    });
  }

  private toRawPage(entry: FrontierEntry, page: FetchedPage, markdownVariantUrl: string | null): RawPage {
    return {
      normalisedUrl: entry.url,
      finalUrl: page.finalUrl,
      httpStatusCode: page.httpStatusCode,
      headers: page.headers,
      html: page.html,
      fetchMethod: page.fetchMethod,
      crawlSignals: {
        crawlDepth: entry.crawlDepth,
        discoveredVia: entry.discoveredVia,
        isInSiteNavigation: this.navigationUrls.has(entry.url),
        inboundLinkCount: this.inboundLinkSources.get(entry.url)?.size ?? 0,
      },
      markdownVariantUrl,
      sitemapLastModified: entry.sitemapLastModified,
    };
  }
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
