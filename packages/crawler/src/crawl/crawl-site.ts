import {
  fragmentRoutePathOf,
  type CrawlResult,
  type CrawlStopReason,
  type DiscoverySource,
  type KnownPage,
} from '@llms-txt/contracts';
import { cleanUrlForFetch, isInScope, isOnRelatedHost, normaliseUrl } from '../discovery/normalise-url';
import { HttpFetcher } from '../network/http-fetcher';
import { readPageSignals, readVisibleTextBlocks, type PageSignals } from '../page-signals/read-page-signals';
import { fragmentRouteLinksOf, showsAnotherPage } from '../page-signals/render-decision';
import { CrawlFailureLog } from './crawl-failures';
import type { CrawlSiteOptions } from './crawl-options';
import { CrawlFrontier, type FrontierEntry } from './frontier';
import { CrawlLinkRecord } from './link-record';
import { MachineReadableResourceFinder } from './machine-readable-resources';
import { MarkdownVariantProber } from './markdown-variants';
import { isSuccessStatus } from './media-types';
import { documentationAreaKeyOf, pageFamilyKeyOf } from './page-family';
import { PageFetcher, type FetchedPage } from './page-fetcher';
import { CrawlDeadlineReached, PoliteFetcher } from './polite-fetcher';
import { RobotsGate } from './robots-gate';
import { seedFromExistingLlmsTxt, seedFromSitemaps } from './seed-frontier';

export type { CrawlProgress, CrawlResult, CrawlSiteOptions } from './crawl-options';

/** Fetch attempts per page of budget; failures do not use budget, so they need their own cap. */
const ATTEMPTS_PER_BUDGETED_PAGE = 2;
/**
 * Pages on the site's other hosts that the navigation may add per crawl. Each is one
 * page; its links are not followed. Stored pages on those hosts are re-checked besides.
 */
const MAX_RELATED_HOST_PAGES = 15;
/** Routes rendered to confirm that a homepage linking routes of itself is a hash-routed site. */
const FRAGMENT_ROUTES_OPENED_TO_CONFIRM = 2;

/** How a page was found, for `addToFrontier`. */
interface FrontierSeed {
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  sitemapLastModified?: string | null;
  /** The place a sitemap gave the page; otherwise it comes after everything found so far. */
  order?: number;
  /** Whether a page on another host of the same site may be added. */
  allowRelatedHost?: boolean;
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
  private readonly fetchRootUrl: string;
  private readonly politeFetcher: PoliteFetcher;
  private readonly failures = new CrawlFailureLog();
  private readonly robots: RobotsGate;
  private readonly frontier = new CrawlFrontier();
  private readonly pageFetcher: PageFetcher;
  private readonly markdownVariants: MarkdownVariantProber;
  private readonly machineReadableResources: MachineReadableResourceFinder;
  private readonly links = new CrawlLinkRecord();
  private readonly knownPages = new Map<string, KnownPage>();
  /**
   * The site is one page whose script shows a route named in the URL fragment
   * (`/#/install`). Each route of the root page is then a page of its own, rendered in the
   * browser. Decided from the rendered homepage, and kept once any stored page is a route.
   */
  private routesOnUrlFragment: boolean;
  private readonly fetchedUrls = new Set<string>();
  /** The related-host URLs the homepage navigation links, up to MAX_RELATED_HOST_PAGES. */
  private readonly relatedHostNavigationUrls = new Set<string>();
  private machineReadableResourceUrls: string[] | null = null;
  /** Normalised URLs of the pages passed to onPage, in order. */
  private readonly emittedUrls: string[] = [];
  private readonly unchangedPerSitemapUrls: string[] = [];
  private pagesWithContentCount = 0;
  /** robots.txt disallows the homepage itself, before anything is fetched. */
  private homepageIsDisallowedByRobots = false;

  constructor(private readonly options: CrawlSiteOptions) {
    const rootUrl = normaliseUrl(options.rootUrl);
    if (rootUrl === null) throw new Error(`not a crawlable root URL: ${options.rootUrl}`);
    this.rootUrl = rootUrl;
    this.fetchRootUrl = cleanUrlForFetch(options.rootUrl)!;
    for (const knownPage of options.knownPages ?? []) this.knownPages.set(knownPage.normalisedUrl, knownPage);
    this.routesOnUrlFragment = [...this.knownPages.keys()].some((url) => fragmentRoutePathOf(new URL(url)) !== '');

    this.politeFetcher = new PoliteFetcher({
      fetcher: new HttpFetcher({ networkPolicy: options.networkPolicy, resolveHostname: options.resolveHostname }),
      minRequestIntervalMs: options.minRequestIntervalMs ?? 500,
      deadline: Date.now() + (options.maxCrawlDurationMs ?? 15 * 60_000),
      maxRetryAfterMs: options.maxRetryAfterMs ?? 30_000,
    });
    this.robots = new RobotsGate(rootUrl, this.politeFetcher, this.failures);
    this.pageFetcher = new PageFetcher({
      rootUrl,
      politeFetcher: this.politeFetcher,
      robots: this.robots,
      failures: this.failures,
      knownPages: this.knownPages,
      requiresHeadlessRendering: options.requiresHeadlessRendering ?? null,
      headlessRenderer: options.headlessRenderer,
      networkPolicy: options.networkPolicy,
      resolveHostname: options.resolveHostname,
    });
    this.markdownVariants = new MarkdownVariantProber(rootUrl, this.politeFetcher, this.robots);
    this.machineReadableResources = new MachineReadableResourceFinder(rootUrl, this.politeFetcher, this.robots);
    for (const url of options.knownMachineReadableResourceUrls ?? []) this.machineReadableResources.addCandidate(url);
    this.machineReadableResources.addCandidate(`${rootUrl}/llms-full.txt`);
  }

  async run(): Promise<CrawlResult> {
    const decidedBefore = this.pageFetcher.requiresHeadlessRendering !== null;
    let stopReason: CrawlStopReason;
    try {
      stopReason = await this.crawlUntilStopped();
    } catch (error) {
      if (!(error instanceof CrawlDeadlineReached)) throw error;
      stopReason = 'time_limit';
    }
    if (stopReason !== 'time_limit' && stopReason !== 'robots_txt_unreachable') {
      this.machineReadableResourceUrls = await this.machineReadableResources.find((fileUrl) => this.hasPagesUnder(fileUrl));
    }
    return this.result(stopReason, decidedBefore);
  }

  async close(): Promise<void> {
    await this.politeFetcher.close();
    await this.pageFetcher.close();
  }

  private async crawlUntilStopped(): Promise<CrawlStopReason> {
    await this.robots.load();
    if (this.robots.status === 'unreachable') return 'robots_txt_unreachable';

    const homepageSeed: FrontierSeed = { crawlDepth: 0, discoveredVia: 'navigation' };
    if (!this.addToFrontier(this.fetchRootUrl, homepageSeed)) this.homepageIsDisallowedByRobots = true;
    await this.seedFromDiscovery();
    this.seedFromKnownPages();

    for (;;) {
      if (this.emittedUrls.length >= this.options.pageBudget) return 'page_budget';
      if (this.fetchedUrls.size >= this.options.pageBudget * ATTEMPTS_PER_BUDGETED_PAGE) return 'attempt_limit';
      if (Date.now() >= this.politeFetcher.deadline) return 'time_limit';
      const entry = this.frontier.takeNext();
      if (entry === undefined) return 'frontier_exhausted';
      await this.crawlPage(entry);
      this.options.onProgress?.({
        pagesDiscovered: this.frontier.size,
        pagesFetched: this.emittedUrls.length,
        pagesFailed: this.failures.failures.length,
      });
    }
  }

  private result(stopReason: CrawlStopReason, decidedBefore: boolean): CrawlResult {
    const { requiresHeadlessRendering } = this.pageFetcher;
    const homepageIsDisallowed = this.homepageIsDisallowedByRobots || this.pageFetcher.homepageIsDisallowedByRobots;
    return {
      robotsTxtStatus: this.robots.status,
      // Said only when nothing else was fetched either: it is then why the run has no pages.
      stopReason: homepageIsDisallowed && this.emittedUrls.length === 0 ? 'homepage_disallowed_by_robots' : stopReason,
      pagesFetchedCount: this.emittedUrls.length,
      pagesWithContentCount: this.pagesWithContentCount,
      linkSignals: this.links.linkSignals(this.rootUrl, this.emittedUrls, this.knownPages),
      unchangedPerSitemapUrls: this.unchangedPerSitemapUrls,
      failedFetches: this.failures.failures,
      requiresHeadlessRendering: requiresHeadlessRendering ?? false,
      decidedHeadlessRendering: !decidedBefore && requiresHeadlessRendering !== null,
      machineReadableResourceUrls: this.machineReadableResourceUrls,
    };
  }

  // --- discovery -------------------------------------------------------------------

  /** Queues what the site's sitemaps and its own llms.txt list. */
  private async seedFromDiscovery(): Promise<void> {
    const seeding = {
      rootUrl: this.rootUrl,
      pageBudget: this.options.pageBudget,
      politeFetcher: this.politeFetcher,
      robots: this.robots,
      frontier: this.frontier,
      addSitemapPage: (url: string, sitemapLastModified: string | null, order: number) =>
        this.addToFrontier(url, { crawlDepth: 1, discoveredVia: 'sitemap', sitemapLastModified, order }),
      addLlmsTxtPage: (url: string) => void this.addToFrontier(url, { crawlDepth: 1, discoveredVia: 'existing_llms_txt' }),
      addMachineReadableResourceCandidate: (href: string, baseUrl: string) =>
        this.machineReadableResources.addCandidate(href, baseUrl),
    };
    await seedFromSitemaps(seeding);
    await seedFromExistingLlmsTxt(seeding);
  }

  /**
   * Pages from previous runs are included in crawling for re-checking.
   */
  private seedFromKnownPages(): void {
    for (const knownPage of this.knownPages.values()) {
      // A stored page on a related host is re-checked even if the navigation dropped it.
      const { crawlDepth, discoveredVia } = knownPage;
      this.addToFrontier(knownPage.fetchUrl, { crawlDepth, discoveredVia, allowRelatedHost: true });
    }
    // The links of a page that answers 304 are not read again, so they are queued here.
    for (const knownPage of this.knownPages.values()) {
      if (knownPage.isRemoved) continue;
      for (const link of knownPage.outboundLinkUrls ?? []) {
        this.addToFrontier(link, { crawlDepth: knownPage.crawlDepth + 1, discoveredVia: 'page_link' });
      }
    }
  }

  /** Whether the directory a file is in has pages of the site under it. */
  private hasPagesUnder(fileUrl: string): boolean {
    const directoryUrl = fileUrl.slice(0, fileUrl.lastIndexOf('/') + 1);
    for (const pageUrl of this.frontier.urls()) if (pageUrl.startsWith(directoryUrl)) return true;
    for (const pageUrl of this.knownPages.keys()) if (pageUrl.startsWith(directoryUrl)) return true;
    return false;
  }

  /**
   * A page's identity. On a site that routes on the URL fragment, a route of the root page
   * is a page; anywhere else a fragment is a place in a page and is dropped.
   */
  private pageUrlOf(rawUrl: string): string | null {
    const url = normaliseUrl(rawUrl);
    return this.routesOnUrlFragment && url === this.rootUrl ? normaliseUrl(rawUrl, { keepRouteFragment: true }) : url;
  }

  /** What is requested for a page: with its route, where `pageUrlOf` keeps one. */
  private fetchUrlOf(rawUrl: string): string | null {
    const keepRouteFragment = this.routesOnUrlFragment && normaliseUrl(rawUrl) === this.rootUrl;
    return cleanUrlForFetch(rawUrl, { keepRouteFragment });
  }

  /**
   * Adds the URL to the frontier if it belongs to the crawl: a page of the site that
   * robots.txt allows, or, where the seed says so, one on another host of the same site.
   * Returns whether it was added.
   */
  private addToFrontier(rawUrl: string, seed: FrontierSeed): boolean {
    const url = this.pageUrlOf(rawUrl);
    const fetchUrl = this.fetchUrlOf(rawUrl);
    if (url === null || fetchUrl === null) return false;
    const isRelated = !isInScope(url, this.rootUrl);
    if (isRelated && !(seed.allowRelatedHost === true && isOnRelatedHost(url, this.rootUrl))) return false;
    if (!isRelated && !this.robots.isAllowed(fetchUrl)) return false;
    return this.frontier.add({
      url,
      fetchUrl,
      crawlDepth: seed.crawlDepth,
      discoveredVia: seed.discoveredVia,
      sitemapLastModified: seed.sitemapLastModified ?? null,
      order: seed.order,
      familyKey: isRelated ? null : pageFamilyKeyOf(url, this.rootUrl),
      documentationAreaKey: isRelated ? null : documentationAreaKeyOf(url, this.rootUrl),
      isOnRelatedHost: isRelated,
    });
  }

  // --- fetching --------------------------------------------------------------------

  private async crawlPage(entry: FrontierEntry): Promise<void> {
    if (this.fetchedUrls.has(entry.url)) return;
    if (this.isUnchangedPerSitemap(entry)) {
      this.unchangedPerSitemapUrls.push(entry.url);
      return;
    }
    this.fetchedUrls.add(entry.url);
    if (entry.isOnRelatedHost && !(await this.robots.isAllowedOnRelatedHost(entry.fetchUrl))) return;

    const page = await this.pageFetcher.fetch(entry);
    if (page === null) return;
    const finalUrl = this.landingUrlOf(entry, page);
    if (finalUrl === null) return;
    const read = await this.readPage(entry, page, finalUrl);
    if (read === null) return;

    this.emittedUrls.push(entry.url);
    if (isSuccessStatus(page.httpStatusCode) || page.httpStatusCode === 304) this.pagesWithContentCount += 1;
    await this.options.onPage({
      normalisedUrl: entry.url,
      fetchUrl: entry.fetchUrl,
      finalUrl: page.finalUrl,
      httpStatusCode: page.httpStatusCode,
      headers: page.headers,
      html: page.html,
      fetchMethod: page.fetchMethod,
      crawlSignals: {
        crawlDepth: entry.crawlDepth,
        discoveredVia: entry.discoveredVia,
        hasNoindexDirective: read.hasNoindexDirective,
      },
      markdownVariantUrl: read.markdownVariantUrl,
      sitemapLastModified: entry.sitemapLastModified,
      outboundLinkUrls: this.links.outboundLinksRead.get(entry.url) ?? null,
    });
  }

  /**
   * Where the page ended up after redirects, as a page URL. Null when that is not a page
   * of this crawl, or is one already fetched.
   */
  private landingUrlOf(entry: FrontierEntry, page: FetchedPage): string | null {
    // A redirect elsewhere in scope lands on a URL that may also be in the frontier.
    const finalUrl = this.pageUrlOf(page.finalUrl);
    if (finalUrl === null) return null;
    if (entry.isOnRelatedHost) {
      // A related host that only redirects into the site (example.com to www.example.com)
      // is that page of the site, crawled as any other.
      if (isInScope(finalUrl, this.rootUrl)) {
        this.addToFrontier(page.finalUrl, { crawlDepth: entry.crawlDepth, discoveredVia: entry.discoveredVia });
        return null;
      }
      if (!isOnRelatedHost(finalUrl, this.rootUrl)) return null;
    } else if (!isInScope(finalUrl, this.rootUrl)) return null;
    if (finalUrl !== entry.url) {
      if (this.fetchedUrls.has(finalUrl)) return null;
      this.fetchedUrls.add(finalUrl);
      this.frontier.markFetched(finalUrl);
    }
    return finalUrl;
  }

  /**
   * Reads what the crawl needs from a fetched page: its links, its robots directives and
   * its markdown file. Null when the page only forwards to another with a meta refresh.
   */
  private async readPage(
    entry: FrontierEntry,
    page: FetchedPage,
    finalUrl: string,
  ): Promise<{ hasNoindexDirective: boolean; markdownVariantUrl: string | null } | null> {
    if (!isSuccessStatus(page.httpStatusCode)) {
      if (page.httpStatusCode === 304) this.links.notModifiedUrls.add(entry.url);
      else if (page.httpStatusCode === 404 || page.httpStatusCode === 410) this.links.notFoundUrls.add(entry.url);
      return { hasNoindexDirective: false, markdownVariantUrl: null };
    }
    const isHomepage = entry.crawlDepth === 0;
    const signals = readPageSignals(page.html, page.finalUrl, page.headers);
    if (isHomepage && page.fetchMethod === 'headless_browser' && !this.routesOnUrlFragment) {
      this.routesOnUrlFragment = await this.homepageRoutesOnUrlFragment(page, signals);
    }
    if (this.followMetaRefresh(entry, finalUrl, signals)) return null;
    if (entry.isOnRelatedHost) {
      // Its links are not followed: an empty list, so it can still answer 304 next time.
      this.links.outboundLinksRead.set(entry.url, []);
      return { hasNoindexDirective: signals.isNoindex, markdownVariantUrl: null };
    }
    this.followLinks(entry, signals);
    const { routesOnUrlFragment } = this;
    const markdownVariantUrl = await this.markdownVariants.probe(page.finalUrl, { isHomepage, routesOnUrlFragment });
    return { hasNoindexDirective: signals.isNoindex, markdownVariantUrl };
  }

  /**
   * If the sitemap says the page is unchanged from last time.
   * 
   * Only trusted if the site's sitemap has proven trustworthy, like how other crawlers work.
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
   * Whether the rendered homepage is a site that routes on the URL fragment: it links
   * mostly routes of itself, and the first of them, opened, show other pages than it does.
   */
  private async homepageRoutesOnUrlFragment(homepage: FetchedPage, signals: PageSignals): Promise<boolean> {
    const routeLinks = fragmentRouteLinksOf(signals, this.rootUrl).slice(0, FRAGMENT_ROUTES_OPENED_TO_CONFIRM);
    if (routeLinks.length === 0) return false;
    const homepageText = readVisibleTextBlocks(homepage.html);
    for (const routeLink of routeLinks) {
      const routeUrl = cleanUrlForFetch(routeLink, { keepRouteFragment: true });
      if (routeUrl === null || !this.robots.isAllowed(routeUrl)) return false;
      const route = await this.pageFetcher.render(routeUrl, { recordFailure: false });
      if (route === null || !showsAnotherPage(homepageText, readVisibleTextBlocks(route.html))) return false;
    }
    return true;
  }

  /**
   * Follow pages that are really a redirect written in HTML.
   */
  private followMetaRefresh(entry: FrontierEntry, finalUrl: string, signals: PageSignals): boolean {
    if (entry.crawlDepth === 0 || signals.metaRefreshUrl === null) return false;
    const targetUrl = this.pageUrlOf(signals.metaRefreshUrl);
    if (targetUrl === null || targetUrl === entry.url || targetUrl === finalUrl) return false;

    const { crawlDepth, discoveredVia } = entry;
    this.addToFrontier(signals.metaRefreshUrl, { crawlDepth, discoveredVia, allowRelatedHost: entry.isOnRelatedHost });
    if (this.frontier.has(targetUrl)) {
      const { navigationLinks } = this.links;
      const navigationLink = navigationLinks.get(entry.url);
      if (navigationLink !== undefined && !navigationLinks.has(targetUrl)) navigationLinks.set(targetUrl, navigationLink);
      this.links.metaRefreshTargets.set(entry.url, targetUrl);
    }
    return true;
  }

  private followLinks(entry: FrontierEntry, signals: PageSignals): void {
    const sourceUrl = entry.url;
    this.links.outboundLinksRead.set(sourceUrl, []);
    if (entry.crawlDepth === 0) {
      this.links.homepageWasRead = true;
      this.followNavigationLinks(signals);
    }
    if (signals.isNofollow) return;

    const outboundLinks = new Set<string>();
    for (const link of signals.linkUrls) {
      if (this.machineReadableResources.addCandidate(link)) continue;
      const url = this.pageUrlOf(link);
      if (url === null || url === sourceUrl) continue;
      // Links to a related-host page count toward it, but only the navigation queues one.
      if (!isInScope(url, this.rootUrl) && this.frontier.get(url)?.isOnRelatedHost !== true) continue;
      outboundLinks.add(url);
      this.addToFrontier(link, { crawlDepth: entry.crawlDepth + 1, discoveredVia: 'page_link' });
    }
    this.links.outboundLinksRead.set(sourceUrl, [...outboundLinks]);
  }

  /** Queues the pages the homepage's navigation links, and notes each one's label and place. */
  private followNavigationLinks(signals: PageSignals): void {
    for (const [position, navigationLink] of signals.navigationLinks.entries()) {
      const url = this.pageUrlOf(navigationLink.url);
      if (url === null || !this.queueNavigationLink(navigationLink.url, url, signals.isNofollow)) continue;
      if (!this.links.navigationLinks.has(url)) this.links.navigationLinks.set(url, { label: navigationLink.label, position });
    }
  }

  /** Queues a navigation link where it may be followed. Returns whether its page counts as in the navigation. */
  private queueNavigationLink(rawUrl: string, url: string, isNofollow: boolean): boolean {
    const seed: FrontierSeed = { crawlDepth: 1, discoveredVia: 'navigation' };
    if (isInScope(url, this.rootUrl)) {
      // Membership is a fact about the page; nofollow only forbids following the link.
      if (!isNofollow) this.addToFrontier(rawUrl, seed);
      return true;
    }
    // The site's other hosts (docs.example.com), as far as its navigation names them.
    if (isNofollow || !isOnRelatedHost(url, this.rootUrl)) return false;
    // Counted apart from stored pages, so the same links are taken on every crawl.
    if (!this.relatedHostNavigationUrls.has(url)) {
      if (this.relatedHostNavigationUrls.size >= MAX_RELATED_HOST_PAGES) return false;
      this.relatedHostNavigationUrls.add(url);
    }
    this.addToFrontier(rawUrl, { ...seed, allowRelatedHost: true });
    return this.frontier.has(url);
  }
}
