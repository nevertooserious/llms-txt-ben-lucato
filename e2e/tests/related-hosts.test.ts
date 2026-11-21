import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { KnownPage } from '@llms-txt/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectCrawl, type CollectedCrawl } from '../support/collect-crawl';
import { allowLoopbackPorts } from '../support/local-network-policy';

// What the crawler takes from the homepage navigation beyond the links themselves: each
// link's label and place, single pages on the site's other hosts, and the targets of
// pages that only redirect with a meta refresh.

const resolveHostname = async () => ['127.0.0.1'];
const page = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="en"><head><title>${title}</title>${head}</head><body>${body}</body></html>`;

let server: Server;
let port: number;
let requests: string[];
let crawl: CollectedCrawl;

/** www.site.test is the site, docs.site.test another host of it, other.test someone else's. */
function respond(host: string, path: string): { status: number; type: string; body: string } {
  const html = (body: string) => ({ status: 200, type: 'text/html', body });
  const notFound = { status: 404, type: 'text/plain', body: 'Not found' };
  if (host === 'docs.site.test') {
    if (path === '/robots.txt') return { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /private/\n' };
    if (path === '/') return html(page('Documentation', '<main><p>The manual.</p><a href="/deeper">Deeper</a></main>'));
    if (path === '/deeper' || path === '/private/notes') return html(page('Not for the crawl', '<main>Hidden</main>'));
    return notFound;
  }
  if (host === 'other.test') return html(page('Someone else', '<main>Elsewhere</main>'));
  // www.moved.test links fifteen pages on docs.moved.test, each of which has moved.
  if (host === 'docs.moved.test') {
    const moved = /^\/old\/(\d+)$/.exec(path);
    if (moved) return html(page('Moved', '<main>Moved.</main>', `<meta http-equiv="refresh" content="0; url=/new/${moved[1]}">`));
    if (path.startsWith('/new/')) return html(page(`Manual, part ${path.slice(5)}`, '<main><p>A part of the manual.</p></main>'));
    return notFound;
  }
  if (host === 'www.moved.test') {
    const links = Array.from({ length: 15 }, (_, index) => `<a href="http://docs.moved.test:${port}/old/${index}">Part ${index}</a>`);
    return path === '/' ? html(page('Moved site', `<nav>${links.join('')}</nav><main><p>Welcome.</p></main>`)) : notFound;
  }
  if (path === '/') {
    return html(
      page(
        'Site',
        `<nav>
          <a href="/guide">Guide</a>
          <a href="http://docs.site.test:${port}/">Docs</a>
          <a href="http://docs.site.test:${port}/private/notes">Private notes</a>
          <a href="http://other.test:${port}/">Partner</a>
          <a href="/old-place">Old place</a>
        </nav>
        <main><p>Welcome.</p><a href="http://docs.site.test:${port}/">Read the docs</a></main>`,
      ),
    );
  }
  if (path === '/guide') return html(page('Guide', `<main><a href="http://docs.site.test:${port}/">The docs</a></main>`));
  if (path === '/old-place') {
    return html(page('Moved', '<main>You should have been redirected.</main>', '<meta http-equiv="refresh" content="0; url=/new-place">'));
  }
  if (path === '/new-place') return html(page('New place', '<main><p>Here now.</p></main>'));
  return notFound;
}

beforeAll(async () => {
  requests = [];
  server = createServer((request, response) => {
    const host = (request.headers.host ?? '').split(':')[0]!;
    requests.push(`${host}${request.url}`);
    const { status, type, body } = respond(host, request.url ?? '/');
    response.writeHead(status, { 'content-type': type }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  crawl = await collectCrawl({
    rootUrl: `http://www.site.test:${port}`,
    pageBudget: 20,
    networkPolicy: allowLoopbackPorts([port]),
    resolveHostname,
    minRequestIntervalMs: 0,
    requiresHeadlessRendering: false,
  });
});

afterAll(() => server?.close());

const crawledUrls = () => crawl.pages.map((crawled) => crawled.normalisedUrl);

describe('navigation signals', () => {
  it('records each navigation link’s label and its place among them', () => {
    expect(crawl.linkSignals[`http://www.site.test:${port}/guide`]).toMatchObject({
      isInSiteNavigation: true,
      navigationLabel: 'Guide',
      navigationPosition: 0,
    });
  });
});

describe('related hosts', () => {
  it('fetches a page on another host of the site that the navigation links, as one page', () => {
    const docsUrl = `http://docs.site.test:${port}`;
    expect(crawledUrls()).toContain(docsUrl);
    // Linked from the homepage and the guide.
    expect(crawl.linkSignals[docsUrl]).toEqual({
      isInSiteNavigation: true,
      inboundLinkCount: 2,
      navigationLabel: 'Docs',
      navigationPosition: 1,
    });
    expect(crawledUrls()).not.toContain(`${docsUrl}/deeper`);
    expect(requests).not.toContain('docs.site.test/deeper');
  });

  it('obeys the related host’s own robots.txt', () => {
    expect(requests).toContain('docs.site.test/robots.txt');
    expect(requests).not.toContain('docs.site.test/private/notes');
    expect(crawledUrls()).not.toContain(`http://docs.site.test:${port}/private/notes`);
  });

  it('leaves other sites alone', () => {
    expect(requests.filter((request) => request.startsWith('other.test'))).toEqual([]);
  });
});

describe('related hosts over several crawls', () => {
  it('gives the same pages the same navigation signals when they are already stored', async () => {
    const options = {
      rootUrl: `http://www.moved.test:${port}`,
      pageBudget: 60,
      networkPolicy: allowLoopbackPorts([port]),
      resolveHostname,
      minRequestIntervalMs: 0,
      requiresHeadlessRendering: false,
    };
    const first = await collectCrawl(options);
    const knownPages: KnownPage[] = first.pages.map((crawled) => ({
      normalisedUrl: crawled.normalisedUrl,
      fetchUrl: crawled.fetchUrl,
      crawlDepth: crawled.crawlSignals.crawlDepth,
      discoveredVia: crawled.crawlSignals.discoveredVia,
      httpEtag: null,
      httpLastModified: null,
      sitemapLastModifiedAt: null,
    }));
    const second = await collectCrawl({ ...options, knownPages });

    const movedPages = Object.keys(first.linkSignals).filter((url) => url.includes('/new/'));
    expect(movedPages).toHaveLength(15);
    expect(movedPages.every((url) => first.linkSignals[url]!.isInSiteNavigation)).toBe(true);
    expect(second.linkSignals).toEqual(first.linkSignals);
  });
});

describe('meta refresh', () => {
  it('crawls the target in place of a page that only redirects, keeping its place in the navigation', () => {
    expect(crawledUrls()).not.toContain(`http://www.site.test:${port}/old-place`);
    expect(crawledUrls()).toContain(`http://www.site.test:${port}/new-place`);
    expect(crawl.linkSignals[`http://www.site.test:${port}/new-place`]).toMatchObject({
      isInSiteNavigation: true,
      navigationLabel: 'Old place',
    });
  });
});
