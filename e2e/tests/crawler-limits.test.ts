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

  it('finds the homepage’s markdown under index.md when there is no index.html.md', async () => {
    const { rootUrl, port } = await serve((request, response) => {
      if (request.url === '/') response.writeHead(200, { 'content-type': 'text/html' }).end(html('Hello'));
      else if (request.url === '/index.md') response.writeHead(200, { 'content-type': 'text/markdown' }).end('# Hello\n');
      else response.writeHead(404).end();
    });
    const result = await crawl(rootUrl, port);
    expect(result.pages[0]?.markdownVariantUrl).toBe(`${rootUrl}/index.md`);
  });

  describe('a family of many pages', () => {
    const links = (paths: string[]) => paths.map((path) => `<a href="${path}">${path}</a>`).join(' ');
    const numbered = (prefix: string) => Array.from({ length: 30 }, (_, index) => `${prefix}/${index + 1}`);
    const serveSiteLinking = (paths: string[]) =>
      serve((request, response) => {
        if (request.url === '/') response.writeHead(200, { 'content-type': 'text/html' }).end(html(links(paths)));
        else if (paths.includes(request.url!)) response.writeHead(200, { 'content-type': 'text/html' }).end(html(`Page ${request.url}`));
        else response.writeHead(404).end();
      });
    const pathsOf = (result: Awaited<ReturnType<typeof crawl>>, rootUrl: string) =>
      result.pages.map((page) => page.normalisedUrl.slice(rootUrl.length));

    it('waits behind the site’s other pages once a dozen of it are fetched', async () => {
      // A blog links its latest posts before its about page, and has more posts than budget.
      const { rootUrl, port } = await serveSiteLinking([...numbered('/posts'), '/team/people', '/story/history']);
      const paths = pathsOf(await crawl(rootUrl, port, { pageBudget: 16 }), rootUrl);
      expect(paths).toHaveLength(16);
      expect(paths).toEqual(expect.arrayContaining(['/team/people', '/story/history']));
      // The rest of the budget goes back to the posts, in the site's order.
      expect(paths.filter((path) => path.startsWith('/posts/'))).toEqual(numbered('/posts').slice(0, 13));
    });

    it('is fetched in the site’s order when it is documentation', async () => {
      const { rootUrl, port } = await serveSiteLinking([...numbered('/docs'), '/team/people']);
      const paths = pathsOf(await crawl(rootUrl, port, { pageBudget: 16 }), rootUrl);
      expect(paths).toEqual(['', ...numbered('/docs').slice(0, 15)]);
    });
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

  it('does not take links that open a section of one page for routes, as on a Swagger UI page', async () => {
    // Every operation is on the page from the start; `#/Pets/addPet` only opens its details.
    const swaggerLikeApp = `<script>
      var operations = ['listPets', 'addPet', 'getPet', 'deletePet'];
      function render() {
        var opened = (location.hash.split('/')[2] || '');
        document.querySelector('main').innerHTML = operations.map(function (name) {
          return '<section><a href="#/Pets/' + name + '">' + name + '</a><p>The ' + name + ' operation of the pet store API, described at some length.</p>' +
            (name === opened ? '<p>Parameters and responses.</p>' : '') + '</section>';
        }).join('');
      }
      window.addEventListener('hashchange', render);
      render();
    </script>`;
    const { rootUrl, port } = await serve((request, response) => {
      if (request.url === '/robots.txt') response.writeHead(404).end();
      else response.writeHead(200, { 'content-type': 'text/html' }).end(html(swaggerLikeApp));
    });
    const headlessRenderer = new HeadlessRenderer({ networkPolicy: allowLoopbackPorts([port]), timeoutMs: 10_000 });
    try {
      const result = await crawl(rootUrl, port, { requiresHeadlessRendering: true, headlessRenderer });
      expect(result.pages.map((page) => page.normalisedUrl)).toEqual([rootUrl]);
      expect(result.failedFetches).toEqual([]);
    } finally {
      await headlessRenderer.close();
    }
  });

  it('lists an llms.txt for a section with pages under it, not one that stands beside a single page', async () => {
    const pages: Record<string, string> = {
      '/': html('<a href="/docs/">Docs</a>'),
      '/docs/': html('<a href="/docs/intro">Intro</a> <a href="/docs/llms.txt">Section index</a>'),
      // svelte.dev publishes each page's text at <page>/llms.txt.
      '/docs/intro': html('Introduction. <a href="/docs/intro/llms.txt">This page for LLMs</a>'),
    };
    const { rootUrl, port } = await serve((request, response) => {
      const path = request.url ?? '/';
      if (path.endsWith('/llms.txt')) response.writeHead(200, { 'content-type': 'text/plain' }).end('# Text\n');
      else if (pages[path] !== undefined) response.writeHead(200, { 'content-type': 'text/html' }).end(pages[path]);
      else response.writeHead(404).end();
    });
    const result = await crawl(rootUrl, port);
    expect(result.machineReadableResourceUrls).toEqual([`${rootUrl}/docs/llms.txt`]);
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
