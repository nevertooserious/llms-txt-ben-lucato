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

  it('renders an app whose script bundle is larger than a page may be, up to the limits for scripts', async () => {
    // Real client-rendered apps ship bundles of 10 MB and more. Scaled down here: each
    // script is 1.5 MB, over the 1 MB allowed for other responses.
    const padding = `/*${'x'.repeat(1.5 * 1024 * 1024)}*/`;
    const script = (text: string) => `${padding}document.body.insertAdjacentHTML('beforeend', '<p>${text}</p>');`;
    const { rootUrl, port } = await serve((request, response) => {
      if (request.url === '/app.js') response.writeHead(200, { 'content-type': 'text/javascript' }).end(script('From the bundle'));
      else if (request.url === '/more.js') response.writeHead(200, { 'content-type': 'text/javascript' }).end(script('From a second bundle'));
      else if (request.url === '/two-bundles') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(html('<script src="/app.js"></script><script src="/more.js"></script>'));
      } else response.writeHead(200, { 'content-type': 'text/html' }).end(html('<script src="/app.js"></script>'));
    });
    const megabyte = 1024 * 1024;
    const headlessRenderer = new HeadlessRenderer({
      networkPolicy: allowLoopbackPorts([port]),
      timeoutMs: 10_000,
      maxResponseBytes: megabyte,
      maxScriptBytes: 2 * megabyte,
      maxRenderBytes: 2.5 * megabyte,
    });
    try {
      const oneBundle = await headlessRenderer.render(rootUrl);
      expect(oneBundle).toMatchObject({ kind: 'rendered', html: expect.stringContaining('From the bundle') });

      // Together the two bundles pass what one render may download, so they cannot both
      // arrive. Which is cut short depends on how the browser interleaves the downloads.
      const twoBundles = await headlessRenderer.render(`${rootUrl}/two-bundles`);
      if (twoBundles.kind !== 'rendered') throw new Error(`expected a rendered page, got ${twoBundles.reason}`);
      const arrived = ['From the bundle', 'From a second bundle'].filter((text) => twoBundles.html.includes(text));
      expect(arrived.length).toBeLessThan(2);
    } finally {
      await headlessRenderer.close();
    }
  });

  it('renders an app that waits for a stylesheet before showing a route, without fetching the stylesheet', async () => {
    const requested: string[] = [];
    // What Vite's preload helper does for a route loaded on demand.
    const waitForStylesheet = `<script>
      var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/route.css';
      link.onload = function () { document.body.insertAdjacentHTML('beforeend', '<p>The route</p>'); };
      link.onerror = function () { document.body.insertAdjacentHTML('beforeend', '<p>Unable to preload CSS</p>'); };
      document.head.appendChild(link);
    </script>`;
    const { rootUrl, port } = await serve((request, response) => {
      requested.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/html' }).end(html(waitForStylesheet));
    });
    const headlessRenderer = new HeadlessRenderer({ networkPolicy: allowLoopbackPorts([port]), timeoutMs: 10_000 });
    try {
      const rendered = await headlessRenderer.render(rootUrl);
      expect(rendered).toMatchObject({ kind: 'rendered', html: expect.stringContaining('The route') });
      expect(requested).not.toContain('/route.css');
    } finally {
      await headlessRenderer.close();
    }
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
