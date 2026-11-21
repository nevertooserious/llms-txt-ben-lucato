import { HeadlessRenderer, type CrawlSiteOptions, type NetworkPolicy } from '@llms-txt/crawler';
import { collectCrawl, type CollectedCrawl } from '../support/collect-crawl';
import type { RawPage } from '@llms-txt/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../support/fixture-site-server';
import { allowLoopbackPorts } from '../support/local-network-policy';

// The crawler follows open conventions: RFC 9309 for robots.txt, the sitemaps protocol,
// RFC 9110 for Retry-After, robots directives in meta tags and X-Robots-Tag, and RFC 3986
// for which URL to request.

const SITE_NAMES = ['conventions-site', 'robots-unreachable-site', 'crawl-delay-site', 'hydrated-site', 'client-app-shell'] as const;
type SiteName = (typeof SITE_NAMES)[number];

const sites = {} as Record<SiteName, FixtureSite>;
let networkPolicy: NetworkPolicy;
let headlessRenderer: HeadlessRenderer;
/** The conventions site is crawled once and the result shared by most tests. */
let conventionsCrawl: CollectedCrawl;

beforeAll(async () => {
  const started = await Promise.all(SITE_NAMES.map((name) => startFixtureSite(name)));
  SITE_NAMES.forEach((name, index) => (sites[name] = started[index]!));
  networkPolicy = allowLoopbackPorts(started.map((site) => site.port));
  headlessRenderer = new HeadlessRenderer({ networkPolicy, timeoutMs: 15_000 });
  conventionsCrawl = await crawl('conventions-site');
});

afterAll(async () => {
  await headlessRenderer?.close();
  await Promise.all(Object.values(sites).map((site) => site.close()));
});

function crawl(siteName: SiteName, options: Partial<Omit<CrawlSiteOptions, 'onPage'>> = {}): Promise<CollectedCrawl> {
  return collectCrawl({
    rootUrl: sites[siteName].origin,
    pageBudget: 50,
    networkPolicy,
    headlessRenderer,
    minRequestIntervalMs: 0,
    ...options,
  });
}

function pageAt(result: CollectedCrawl, site: FixtureSite, path: string): RawPage | undefined {
  const url = path === '/' ? site.origin : `${site.origin}${path}`;
  return result.pages.find((page) => page.normalisedUrl === url);
}

describe('robots.txt (RFC 9309)', () => {
  it('parses a 2xx robots.txt whatever its media type', () => {
    const site = sites['conventions-site'];
    expect(conventionsCrawl.robotsTxtStatus).toBe('parsed');
    expect(site.requestLog.filter((path) => path.startsWith('/private/'))).toEqual([]);
  });

  it('does not follow a redirect into a disallowed path, and does not count it as a failure', () => {
    const site = sites['conventions-site'];
    expect(site.requestLog).toContain('/moved');
    expect(site.requestLog).not.toContain('/private/target');
    expect(pageAt(conventionsCrawl, site, '/moved')).toBeUndefined();
    expect(conventionsCrawl.failedFetches).toEqual([]);
  });

  it('treats a missing robots.txt as allowing everything', async () => {
    const result = await crawl('hydrated-site', { requiresHeadlessRendering: false });
    expect(result.robotsTxtStatus).toBe('unavailable');
    expect(result.pages.length).toBeGreaterThan(1);
  });

  it('fetches nothing when robots.txt answers 5xx, and says why', async () => {
    const site = sites['robots-unreachable-site'];
    const result = await crawl('robots-unreachable-site');
    expect(result).toMatchObject({ robotsTxtStatus: 'unreachable', stopReason: 'robots_txt_unreachable', pages: [] });
    expect(result.failedFetches).toMatchObject([{ reason: 'robots_txt_unreachable' }]);
    expect(site.requestLog).toEqual(['/robots.txt']);
  });

  it('honours Crawl-delay as given, and stops at the time limit instead of speeding up', async () => {
    const site = sites['crawl-delay-site'];
    const requestsBefore = site.requestLog.length;
    const result = await crawl('crawl-delay-site', { maxCrawlDurationMs: 3_500 });
    expect(result.stopReason).toBe('time_limit');
    const times = site.requestTimes.slice(requestsBefore);
    const gaps = times.slice(1).map((time, index) => time - times[index]!);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(950);
  });

  it('applies robots.txt to the headless browser, page and subresources alike', async () => {
    const site = sites['client-app-shell'];
    const withoutScript = await headlessRenderer.render(`${site.origin}/features`, {
      isUrlAllowed: (url) => !url.endsWith('/app.js'),
    });
    if (withoutScript.kind !== 'rendered') throw new Error(`render failed: ${withoutScript.message}`);
    expect(withoutScript.html).not.toContain('Real-time charts');

    const disallowedPage = await headlessRenderer.render(`${site.origin}/pricing`, {
      isUrlAllowed: (url) => !url.includes('/pricing'),
    });
    expect(disallowedPage).toMatchObject({ kind: 'failed', reason: 'disallowed_by_robots' });
  });
});

describe('sitemaps protocol', () => {
  it('reads gzipped and plain-text sitemaps listed in robots.txt', () => {
    const site = sites['conventions-site'];
    expect(pageAt(conventionsCrawl, site, '/from-gzip-sitemap')?.crawlSignals.discoveredVia).toBe('sitemap');
    expect(pageAt(conventionsCrawl, site, '/from-text-sitemap')?.crawlSignals.discoveredVia).toBe('sitemap');
  });
});

describe('robots directives', () => {
  it('does not follow links on a page with X-Robots-Tag: nofollow', () => {
    const site = sites['conventions-site'];
    expect(pageAt(conventionsCrawl, site, '/nofollow-header')).toBeDefined();
    expect(site.requestLog).not.toContain('/only-behind-nofollow');
  });

  it('flags a noindex page for the generator to leave out', () => {
    const site = sites['conventions-site'];
    expect(pageAt(conventionsCrawl, site, '/noindex-page')?.crawlSignals.hasNoindexDirective).toBe(true);
    expect(pageAt(conventionsCrawl, site, '/')?.crawlSignals.hasNoindexDirective).toBe(false);
  });
});

describe('HTTP', () => {
  it('requests the URL as linked: keeps the trailing slash, keys on the normalised URL', () => {
    const site = sites['conventions-site'];
    const page = pageAt(conventionsCrawl, site, '/slash-only');
    expect(page?.httpStatusCode).toBe(200);
    expect(page?.finalUrl).toBe(`${site.origin}/slash-only/`);
    expect(site.requestLog).not.toContain('/slash-only');
  });

  it('retries a 503 after its Retry-After', () => {
    const site = sites['conventions-site'];
    expect(pageAt(conventionsCrawl, site, '/maintenance')?.httpStatusCode).toBe(200);
    expect(site.requestLog.filter((path) => path === '/maintenance')).toHaveLength(2);
  });
});
