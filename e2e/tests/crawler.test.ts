import { HeadlessRenderer, type CrawlSiteOptions, type NetworkPolicy } from '@llms-txt/crawler';
import { collectCrawl, type CollectedCrawl } from '../support/collect-crawl';
import type { KnownPage, RawPage } from '@llms-txt/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../support/fixture-site-server';
import { allowLoopbackPorts } from '../support/local-network-policy';

// The crawler against local fixture sites, through real HTTP and real headless Chromium.
// Pipeline-level versions of these cases (through to llms.txt) are in site-flavours.test.ts.

const SITE_NAMES = [
  'static-site',
  'client-app-shell',
  'metadata-ssr-site',
  'hydrated-site',
  'hash-routing-site',
  'mixed-site',
  'markdown-site',
  'large-sitemap-site',
  'rate-limited-site',
  'hostile-site',
] as const;
type SiteName = (typeof SITE_NAMES)[number];

const sites = {} as Record<SiteName, FixtureSite>;
/** Listening, but outside the network policy: stands in for an internal service. */
let internalService: FixtureSite;
let networkPolicy: NetworkPolicy;
/** Shared by every crawl, as the worker shares one, so Chromium launches once. */
let headlessRenderer: HeadlessRenderer;

beforeAll(async () => {
  const started = await Promise.all(SITE_NAMES.map((name) => startFixtureSite(name)));
  SITE_NAMES.forEach((name, index) => (sites[name] = started[index]!));
  internalService = await startFixtureSite('static-site');
  networkPolicy = allowLoopbackPorts(started.map((site) => site.port));
  headlessRenderer = new HeadlessRenderer({ networkPolicy, timeoutMs: 15_000 });
});

afterAll(async () => {
  await headlessRenderer?.close();
  await Promise.all([...Object.values(sites), internalService].map((site) => site?.close()));
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

function pageAt(result: CollectedCrawl, site: FixtureSite, path: string): RawPage {
  const url = path === '/' ? site.origin : `${site.origin}${path}`;
  const page = result.pages.find((candidate) => candidate.normalisedUrl === url);
  if (page === undefined) {
    throw new Error(`no page at ${url}; crawled: ${result.pages.map((candidate) => candidate.normalisedUrl).join(', ')}`);
  }
  return page;
}

const paths = (result: CollectedCrawl, site: FixtureSite) =>
  result.pages.map((page) => page.normalisedUrl.slice(site.origin.length) || '/').sort();

const requestsFor = (site: FixtureSite, pattern: RegExp) => site.requestLog.filter((path) => pattern.test(path));

describe('rendering', () => {
  it('static page: plain HTTP only, no headless render', async () => {
    const result = await crawl('static-site');
    expect(result.requiresHeadlessRendering).toBe(false);
    expect(result.decidedHeadlessRendering).toBe(true);
    expect(result.pages.length).toBeGreaterThanOrEqual(4);
    expect(result.pages.every((page) => page.fetchMethod === 'plain_http')).toBe(true);
  });

  it('client-side app shell: the homepage comparison switches the site to headless', async () => {
    const site = sites['client-app-shell'];
    const result = await crawl('client-app-shell');
    expect(result.requiresHeadlessRendering).toBe(true);
    expect(paths(result, site)).toEqual(['/', '/docs', '/features', '/pricing']);
    expect(result.pages.every((page) => page.fetchMethod === 'headless_browser')).toBe(true);
    expect(pageAt(result, site, '/features').html).toContain('Real-time charts');
    expect(pageAt(result, site, '/pricing').html).toContain('<title>Pricing | Shellfish Analytics</title>');
  });

  it('late-loaded content: waits past network idle, no loading placeholder', async () => {
    const site = sites['client-app-shell'];
    const result = await crawl('client-app-shell', { pageBudget: 1 });
    const home = pageAt(result, site, '/');
    expect(home.html).toContain('scheduled reports now arrive');
    expect(home.html).not.toContain('Loading…');
  });

  it('server-rendered metadata with a client-rendered body: rendered, metadata kept', async () => {
    const site = sites['metadata-ssr-site'];
    const result = await crawl('metadata-ssr-site', { pageBudget: 1 });
    expect(result.requiresHeadlessRendering).toBe(true);
    const home = pageAt(result, site, '/');
    expect(home.fetchMethod).toBe('headless_browser');
    expect(home.html).toContain('<title>Halfway Studio</title>');
    expect(home.html).toContain('We build interfaces in the browser');
  });

  it('server-rendered and hydrated: one comparison render, then plain HTTP', async () => {
    const site = sites['hydrated-site'];
    const scriptRequestsBefore = requestsFor(site, /hydrate\.js/).length;
    const result = await crawl('hydrated-site');
    expect(result.requiresHeadlessRendering).toBe(false);
    expect(paths(result, site)).toEqual(['/', '/blog', '/pricing']);
    expect(result.pages.every((page) => page.fetchMethod === 'plain_http')).toBe(true);
    expect(requestsFor(site, /hydrate\.js/).length - scriptRequestsBefore).toBe(1);
  });

  it('a stored decision skips the comparison render', async () => {
    const site = sites['hydrated-site'];
    const scriptRequestsBefore = requestsFor(site, /hydrate\.js/).length;
    const result = await crawl('hydrated-site', { requiresHeadlessRendering: false });
    expect(result.decidedHeadlessRendering).toBe(false);
    expect(requestsFor(site, /hydrate\.js/).length).toBe(scriptRequestsBefore);
  });

  it('client-rendered section of a server-rendered site: only that page is rendered', async () => {
    const site = sites['mixed-site'];
    const result = await crawl('mixed-site');
    expect(result.requiresHeadlessRendering).toBe(false);
    expect(pageAt(result, site, '/').fetchMethod).toBe('plain_http');
    expect(pageAt(result, site, '/about').fetchMethod).toBe('plain_http');
    const dashboard = pageAt(result, site, '/app');
    expect(dashboard.fetchMethod).toBe('headless_browser');
    expect(dashboard.html).toContain('Trading dashboard');
  });

  it('hash routing: each route of the page is crawled as a page, in the browser', async () => {
    const site = sites['hash-routing-site'];
    const result = await crawl('hash-routing-site');
    expect(result.requiresHeadlessRendering).toBe(true);
    // `#/install?id=usage` is the Install route again, so it adds no page.
    expect(paths(result, site)).toEqual(['/', '/#/configure', '/#/guide', '/#/guide/plugins', '/#/install']);
    expect(result.failedFetches).toEqual([]);

    const install = pageAt(result, site, '/#/install');
    expect(install.fetchMethod).toBe('headless_browser');
    expect(install.html).toContain('Download the binary');
    expect(install.html).not.toContain('Write a config file');
    expect(pageAt(result, site, '/#/guide/plugins').crawlSignals.crawlDepth).toBe(2);
    // The route written in a markdown file is linked to it; the others have none.
    expect(pageAt(result, site, '/#/guide').markdownVariantUrl).toBe(`${site.origin}/guide.md`);
    expect(install.markdownVariantUrl).toBeNull();
    expect(result.linkSignals[`${site.origin}/#/install`]).toMatchObject({ isInSiteNavigation: true, navigationLabel: 'Install' });
  });

  it('hash routing: stored routes are crawled again as routes', async () => {
    const site = sites['hash-routing-site'];
    const result = await crawl('hash-routing-site', {
      requiresHeadlessRendering: true,
      knownPages: [
        {
          normalisedUrl: `${site.origin}/#/install`,
          fetchUrl: `${site.origin}/#/install`,
          crawlDepth: 1,
          discoveredVia: 'navigation',
          httpEtag: null,
          httpLastModified: null,
          sitemapLastModifiedAt: null,
          outboundLinkUrls: [],
          isRemoved: false,
        },
      ],
    });
    expect(paths(result, site)).toEqual(['/', '/#/configure', '/#/guide', '/#/guide/plugins', '/#/install']);
  });
});

describe('re-checking known pages', () => {
  const knownPage = (site: FixtureSite, path: string, fields: Partial<KnownPage> = {}): KnownPage => ({
    normalisedUrl: `${site.origin}${path}`,
    fetchUrl: `${site.origin}${path}`,
    crawlDepth: 1,
    discoveredVia: 'page_link',
    httpEtag: null,
    httpLastModified: null,
    sitemapLastModifiedAt: null,
    outboundLinkUrls: [],
    isRemoved: false,
    ...fields,
  });

  it('computes the same link signals when known pages answer 304', async () => {
    const site = sites['static-site'];
    const first = await crawl('static-site');
    const knownPages = first.pages.map((page) =>
      knownPage(site, new URL(page.normalisedUrl).pathname, {
        normalisedUrl: page.normalisedUrl,
        fetchUrl: page.fetchUrl,
        crawlDepth: page.crawlSignals.crawlDepth,
        discoveredVia: page.crawlSignals.discoveredVia,
        httpEtag: page.headers.etag ?? null,
        outboundLinkUrls: page.outboundLinkUrls,
      }),
    );
    const second = await crawl('static-site', { knownPages });
    expect(second.pages.some((page) => page.httpStatusCode === 304)).toBe(true);
    expect(second.linkSignals).toEqual(first.linkSignals);
  });

  it('reads a known page with no stored links in full, even if it has a validator', async () => {
    const site = sites['static-site'];
    const first = await crawl('static-site');
    const about = pageAt(first, site, '/about');
    const second = await crawl('static-site', {
      knownPages: [knownPage(site, '/about', { fetchUrl: about.fetchUrl, httpEtag: about.headers.etag ?? null, outboundLinkUrls: null })],
    });
    expect(pageAt(second, site, '/about').httpStatusCode).toBe(200);
  });

  it('re-checks a known page that nothing links to any more, so its 404 is seen', async () => {
    const site = sites['static-site'];
    const result = await crawl('static-site', { knownPages: [knownPage(site, '/docs/retired')] });
    expect(pageAt(result, site, '/docs/retired').httpStatusCode).toBe(404);
  });

  it('asks with the stored ETag, and passes on a 304 with no body', async () => {
    const site = sites['static-site'];
    const first = pageAt(await crawl('static-site'), site, '/about');
    expect(first.headers.etag).toBeDefined();
    const result = await crawl('static-site', {
      knownPages: [knownPage(site, '/about', { fetchUrl: first.fetchUrl, httpEtag: first.headers.etag ?? null })],
    });
    const about = pageAt(result, site, '/about');
    expect(about.httpStatusCode).toBe(304);
    expect(about.html).toBe('');
    // The homepage is never asked conditionally: its links are where discovery starts.
    expect(pageAt(result, site, '/').httpStatusCode).toBe(200);
  });

  it('does not request a page whose trusted sitemap lastmod has not moved', async () => {
    const site = sites['static-site'];
    const path = '/docs/unlinked.html';
    const requestsBefore = requestsFor(site, /^\/docs\/unlinked\.html$/).length;
    const result = await crawl('static-site', {
      sitemapLastModifiedIsTrusted: true,
      knownPages: [knownPage(site, path, { discoveredVia: 'sitemap', sitemapLastModifiedAt: '2026-10-01T00:00:00Z' })],
    });
    expect(result.unchangedPerSitemapUrls).toEqual([`${site.origin}${path}`]);
    expect(result.pages.some((page) => page.normalisedUrl === `${site.origin}${path}`)).toBe(false);
    expect(requestsFor(site, /^\/docs\/unlinked\.html$/).length).toBe(requestsBefore);
  });
});

describe('discovery', () => {
  it('seeds from a sitemap, keeping lastmod', async () => {
    const site = sites['static-site'];
    const result = await crawl('static-site');
    const unlinked = pageAt(result, site, '/docs/unlinked.html');
    expect(unlinked.crawlSignals.discoveredVia).toBe('sitemap');
    expect(result.linkSignals[unlinked.normalisedUrl]?.inboundLinkCount).toBe(0);
    expect(unlinked.sitemapLastModified).toBe('2026-10-01');
  });

  it('crawls from navigation when there is no sitemap', async () => {
    const site = sites['hydrated-site'];
    const result = await crawl('hydrated-site', { requiresHeadlessRendering: false });
    const pricing = pageAt(result, site, '/pricing');
    expect(pricing.crawlSignals).toMatchObject({ discoveredVia: 'navigation', crawlDepth: 1 });
    // Linked from the homepage and the blog; its own self-link does not count.
    expect(result.linkSignals[pricing.normalisedUrl]).toMatchObject({ isInSiteNavigation: true, inboundLinkCount: 2 });
    expect(pageAt(result, site, '/').crawlSignals.crawlDepth).toBe(0);
  });

  it('numbers pages in the order it first saw links to them', async () => {
    const result = await crawl('hydrated-site', { requiresHeadlessRendering: false });
    const positions = Object.values(result.linkSignals)
      .map((signals) => signals.firstLinkPosition)
      .filter((position) => position !== null);
    // Every linked page has its own place, counted from 0 with no gaps.
    expect([...positions].sort((a, b) => a - b)).toEqual(positions.map((_position, index) => index));
    // The homepage's own links come before those first seen on the pages it links.
    const depthOneLast = Math.max(...result.pages.filter((page) => page.crawlSignals.crawlDepth === 1).map((page) => result.linkSignals[page.normalisedUrl]!.firstLinkPosition!));
    const deeper = result.pages.filter((page) => page.crawlSignals.crawlDepth > 1).map((page) => result.linkSignals[page.normalisedUrl]!.firstLinkPosition!);
    for (const position of deeper) expect(position).toBeGreaterThan(depthOneLast);
  });

  it('respects the page budget on a large sitemap index', async () => {
    const site = sites['large-sitemap-site'];
    const result = await crawl('large-sitemap-site', { pageBudget: 25 });
    expect(result.pages).toHaveLength(25);
    expect(requestsFor(site, /^\/posts\/\d+$/).length).toBeLessThanOrEqual(25);
  });

  it('fetches a navigation page first even when the sitemap listed it earlier', async () => {
    const site = sites['large-sitemap-site'];
    const result = await crawl('large-sitemap-site', { pageBudget: 25 });
    expect(pageAt(result, site, '/posts/90')?.crawlSignals.discoveredVia).toBe('navigation');
  });

  it('never fetches paths disallowed by robots.txt', async () => {
    const site = sites['static-site'];
    const result = await crawl('static-site');
    expect(paths(result, site)).not.toContain('/private/secret.html');
    expect(requestsFor(site, /^\/private\//)).toEqual([]);
  });

  it('seeds from an existing llms.txt, ignoring out-of-scope links', async () => {
    const site = sites['markdown-site'];
    const result = await crawl('markdown-site');
    expect(pageAt(result, site, '/guides/setup').crawlSignals.discoveredVia).toBe('existing_llms_txt');
    expect(result.pages.every((page) => page.normalisedUrl.startsWith(site.origin))).toBe(true);
  });

  it('finds the site’s machine-readable files, and only those that are there', async () => {
    const site = sites['markdown-site'];
    const result = await crawl('markdown-site');
    // /guides/llms.txt is linked but answers 404; the root llms.txt is what the generated file replaces.
    expect(result.machineReadableResourceUrls).toEqual([`${site.origin}/llms-full.txt`, `${site.origin}/api/openapi.json`]);
    expect(result.pages.some((page) => page.normalisedUrl.includes('openapi'))).toBe(false);
  });

  it('checks known machine-readable files again and drops one that has gone', async () => {
    const site = sites['static-site'];
    const result = await crawl('static-site', { knownMachineReadableResourceUrls: [`${site.origin}/api/openapi.json`] });
    expect(result.machineReadableResourceUrls).toEqual([]);
  });

  it('cannot tell which machine-readable files exist when one answers with an error', async () => {
    const site = sites['static-site'];
    const result = await crawl('static-site', { knownMachineReadableResourceUrls: [`${site.origin}/broken/openapi.json`] });
    expect(result.machineReadableResourceUrls).toBeNull();
  });

  it('links .md variants where they exist', async () => {
    const site = sites['markdown-site'];
    const result = await crawl('markdown-site');
    expect(pageAt(result, site, '/').markdownVariantUrl).toBe(`${site.origin}/index.html.md`);
    expect(pageAt(result, site, '/guides/intro').markdownVariantUrl).toBe(`${site.origin}/guides/intro.md`);
    expect(pageAt(result, site, '/guides/no-markdown').markdownVariantUrl).toBeNull();
  });

  it('stops probing for .md variants on a site that has none', async () => {
    const site = sites['static-site'];
    const probesBefore = requestsFor(site, /\.md$/).length;
    const result = await crawl('static-site');
    expect(result.pages.every((page) => page.markdownVariantUrl === null)).toBe(true);
    expect(requestsFor(site, /\.md$/).length - probesBefore).toBe(3);
  });

  it('stays under a subpath root_url', async () => {
    const site = sites['static-site'];
    const requestsBefore = site.requestLog.length;
    const result = await crawl('static-site', { rootUrl: `${site.origin}/docs` });
    expect(paths(result, site)).toEqual(['/docs', '/docs/getting-started.html', '/docs/unlinked.html']);
    const pageRequests = site.requestLog.slice(requestsBefore).filter((path) => !/robots\.txt|sitemap\.xml|llms\.txt|\.md$/.test(path));
    expect(pageRequests.every((path) => path.startsWith('/docs'))).toBe(true);
  });
});

describe('politeness', () => {
  it('backs off on 429 and honours Retry-After', async () => {
    const site = sites['rate-limited-site'];
    const result = await crawl('rate-limited-site');
    expect(pageAt(result, site, '/catalogue').httpStatusCode).toBe(200);
    expect(result.failedFetches).toEqual([]);

    const catalogueTimes = site.requestLog
      .map((path, index) => (path === '/catalogue' ? site.requestTimes[index]! : null))
      .filter((time): time is number => time !== null);
    expect(catalogueTimes.length).toBeGreaterThanOrEqual(2);
    expect(catalogueTimes.at(-1)! - catalogueTimes.at(-2)!).toBeGreaterThanOrEqual(950);
  });

  it('spaces requests by the minimum interval', async () => {
    const site = sites['static-site'];
    const requestsBefore = site.requestLog.length;
    await crawl('static-site', { minRequestIntervalMs: 150, pageBudget: 3 });
    // A redirect hop is part of one fetch, so /about -> /about/ is measured as one request.
    const requests = site.requestLog
      .map((path, index) => ({ path, time: site.requestTimes[index]! }))
      .slice(requestsBefore)
      .filter((request, index, all) => index === 0 || request.path !== `${all[index - 1]!.path}/`);
    const gaps = requests.slice(1).map((request, index) => request.time - requests[index]!.time);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(140);
  });
});

describe('SSRF guard in the headless browser', () => {
  it('blocks private-address subresources: fetch, XHR and iframes', async () => {
    const hostile = sites['hostile-site'];
    const internalRequestsBefore = internalService.requestLog.length;
    const metadataUrl = 'http://169.254.169.254/latest/meta-data/';
    const targets = [`${internalService.origin}/`, metadataUrl, 'http://[::1]/'].join(',');

    const outcome = await headlessRenderer.render(`${hostile.origin}/browser-ssrf?targets=${encodeURIComponent(targets)}`);
    if (outcome.kind !== 'rendered') throw new Error(`render failed: ${outcome.message}`);
    expect(outcome.html).toContain('Script ran and tried 3 targets');
    expect(outcome.blockedRequestUrls).toEqual(expect.arrayContaining([`${internalService.origin}/`, metadataUrl]));
    expect(internalService.requestLog.length).toBe(internalRequestsBefore);
  });

  it.each([
    ['the cloud metadata address', () => 'http://169.254.169.254/latest/meta-data/'],
    ['a loopback port outside the policy', () => `${internalService.origin}/`],
  ])('blocks a navigation redirect to %s', async (_label, target) => {
    const internalRequestsBefore = internalService.requestLog.length;
    const outcome = await headlessRenderer.render(
      `${sites['hostile-site'].origin}/redirect?to=${encodeURIComponent(target())}`,
    );
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'blocked_address' });
    expect(internalService.requestLog.length).toBe(internalRequestsBefore);
  });

  it('records a blocked page as a failed fetch, not a page', async () => {
    const hostile = sites['hostile-site'];
    const result = await collectCrawl({
      rootUrl: `${hostile.origin}/redirect?to=${encodeURIComponent('http://169.254.169.254/')}`,
      pageBudget: 5,
      networkPolicy,
      headlessRenderer,
      minRequestIntervalMs: 0,
      requiresHeadlessRendering: true,
    });
    expect(result.pages).toEqual([]);
    expect(result.failedFetches).toMatchObject([{ reason: 'blocked_address' }]);
  });
});
