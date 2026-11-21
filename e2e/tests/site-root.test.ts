import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveSiteRootUrl } from '@llms-txt/crawler';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCrawl } from '../support/collect-crawl';
import { allowLoopbackPorts } from '../support/local-network-policy';

// Where a site really lives: the root URL after the homepage's redirect.

const resolveHostname = async () => ['127.0.0.1'];
const page = (body: string) => `<!doctype html><html lang="en"><head><title>Page</title></head><body><main>${body}</main></body></html>`;

let server: Server | undefined;
afterEach(() => server?.close());

async function serve(handler: (port: number) => RequestListener): Promise<number> {
  let port = 0;
  server = createServer((request, response) => handler(port)(request, response));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  return port;
}

/** apex.test redirects everything to www.apex.test, which serves the site. */
const apexToWww =
  (port: number): RequestListener =>
  (request, response) => {
    if (request.headers.host?.startsWith('apex.test')) {
      response.writeHead(301, { location: `http://www.apex.test:${port}${request.url}` }).end();
    } else if (request.url === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /private\n');
    } else if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(page('<a href="/docs">Docs</a>'));
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end(page('Docs'));
    }
  };

describe('resolveSiteRootUrl', () => {
  it('follows a homepage redirect to another origin, and the crawl then finds the site', async () => {
    const port = await serve(apexToWww);
    const networkPolicy = allowLoopbackPorts([port]);
    const rootUrl = await resolveSiteRootUrl({
      rootUrl: `http://apex.test:${port}`,
      networkPolicy,
      resolveHostname,
      minRequestIntervalMs: 0,
    });
    expect(rootUrl).toBe(`http://www.apex.test:${port}`);

    const crawl = await collectCrawl({ rootUrl, pageBudget: 5, networkPolicy, resolveHostname, minRequestIntervalMs: 0, requiresHeadlessRendering: false });
    expect(crawl.pages.map((crawled) => crawled.normalisedUrl)).toContain(`${rootUrl}/docs`);
  });

  it('keeps the root when the homepage redirects within its origin', async () => {
    const port = await serve(() => (request, response) => {
      if (request.url === '/') response.writeHead(302, { location: '/en/' }).end();
      else if (request.url === '/en/') response.writeHead(200, { 'content-type': 'text/html' }).end(page('Hello'));
      else response.writeHead(404).end();
    });
    const rootUrl = `http://same.test:${port}`;
    expect(
      await resolveSiteRootUrl({ rootUrl, networkPolicy: allowLoopbackPorts([port]), resolveHostname, minRequestIntervalMs: 0 }),
    ).toBe(rootUrl);
  });

  it('does not request a homepage robots.txt disallows', async () => {
    const requested: string[] = [];
    const port = await serve(() => (request, response) => {
      requested.push(request.url!);
      if (request.url === '/robots.txt') response.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /\n');
      else response.writeHead(200, { 'content-type': 'text/html' }).end(page('Hello'));
    });
    const rootUrl = `http://closed.test:${port}`;
    expect(
      await resolveSiteRootUrl({ rootUrl, networkPolicy: allowLoopbackPorts([port]), resolveHostname, minRequestIntervalMs: 0 }),
    ).toBe(rootUrl);
    expect(requested).toEqual(['/robots.txt']);
  });
});

describe('a site that refuses the crawler', () => {
  it('records a 403 as a blocked fetch and passes no page on', async () => {
    const port = await serve(() => (_request, response) => {
      response.writeHead(403, { 'content-type': 'text/html' }).end('Forbidden');
    });
    const crawl = await collectCrawl({
      rootUrl: `http://blocked.test:${port}`,
      pageBudget: 5,
      networkPolicy: allowLoopbackPorts([port]),
      resolveHostname,
      minRequestIntervalMs: 0,
      requiresHeadlessRendering: false,
    });
    expect(crawl.pages).toEqual([]);
    expect(crawl.pagesWithContentCount).toBe(0);
    expect(crawl.failedFetches.map((failure) => failure.reason)).toEqual(['blocked']);
  });
});
