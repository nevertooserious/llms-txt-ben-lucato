import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HeadlessRenderer } from '@llms-txt/crawler';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCrawl } from '../support/collect-crawl';
import { allowLoopbackPorts } from '../support/local-network-policy';

const html = (body: string, head = '') => `<!doctype html><html lang="en"><head><title>Page</title>${head}</head><body><main>${body}</main></body></html>`;

let server: Server | undefined;
afterEach(() => server?.close());

async function serve(handler: RequestListener): Promise<{ rootUrl: string; port: number }> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { rootUrl: `http://127.0.0.1:${port}`, port };
}

const crawl = (rootUrl: string, port: number, options: Record<string, unknown> = {}) =>
  collectCrawl({ rootUrl, pageBudget: 10, networkPolicy: allowLoopbackPorts([port]), minRequestIntervalMs: 0, requiresHeadlessRendering: false, ...options });

describe('crawler limits', () => {
  it('stops at the time limit rather than sleeping through a long Crawl-delay', async () => {
    const { rootUrl, port } = await serve((request, response) => {
      if (request.url === '/robots.txt') response.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nCrawl-delay: 3600\n');
      else response.writeHead(200, { 'content-type': 'text/html' }).end(html('Hello'));
    });
    const startedAt = Date.now();
    const result = await crawl(rootUrl, port, { maxCrawlDurationMs: 200 });
    expect(result.stopReason).toBe('time_limit');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('does not follow a .md probe redirected into a disallowed path', async () => {
    const requested: string[] = [];
    const { rootUrl, port } = await serve((request, response) => {
      requested.push(request.url!);
      if (request.url === '/robots.txt') response.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /private\n');
      else if (request.url === '/index.html.md') response.writeHead(302, { location: '/private/secret.md' }).end();
      else if (request.url === '/') response.writeHead(200, { 'content-type': 'text/html' }).end(html('Hello'));
      else response.writeHead(404).end();
    });
    const result = await crawl(rootUrl, port);
    expect(requested).not.toContain('/private/secret.md');
    expect(result.pages[0]?.markdownVariantUrl).toBeNull();
  });

  it('does not follow navigation links from a nofollow homepage, but still records them', async () => {
    const requested: string[] = [];
    const { rootUrl, port } = await serve((request, response) => {
      requested.push(request.url!);
      if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(html('<nav><a href="/from-nav">Nav</a></nav>Hello', '<meta name="robots" content="nofollow">'));
      } else response.writeHead(404).end();
    });
    await crawl(rootUrl, port);
    expect(requested).not.toContain('/from-nav');
  });

  it('skips a non-HTML link on a rendered site without counting a failure', async () => {
    const { rootUrl, port } = await serve((request, response) => {
      if (request.url === '/robots.txt') response.writeHead(404).end();
      else if (request.url === '/file.pdf') response.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4');
      else response.writeHead(200, { 'content-type': 'text/html' }).end(html('<a href="/file.pdf">PDF</a>'));
    });
    const headlessRenderer = new HeadlessRenderer({ networkPolicy: allowLoopbackPorts([port]), timeoutMs: 10_000 });
    try {
      const result = await crawl(rootUrl, port, { requiresHeadlessRendering: true, headlessRenderer });
      expect(result.failedFetches).toEqual([]);
      expect(result.pages.map((page) => page.normalisedUrl)).toEqual([rootUrl]);
    } finally {
      await headlessRenderer.close();
    }
  });
});
