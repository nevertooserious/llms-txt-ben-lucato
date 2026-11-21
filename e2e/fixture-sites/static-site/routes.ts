import type { IncomingMessage } from 'node:http';
import type { FixtureRoutes } from '../../support/fixture-site-server';

// robots.txt and the sitemap need absolute URLs, and the port is only known at run time.

const originOf = (request: IncomingMessage) => `http://${request.headers.host ?? 'localhost'}`;

export const routes: FixtureRoutes = {
  // A machine-readable file whose server is failing: that says nothing about whether it exists.
  '/broken/openapi.json': (_request, response) => {
    response.writeHead(500, { 'content-type': 'text/plain' }).end('internal error');
  },

  '/robots.txt': (request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(
      ['User-agent: *', 'Disallow: /private/', '', `Sitemap: ${originOf(request)}/sitemap.xml`, ''].join('\n'),
    );
  },

  '/sitemap.xml': (request, response) => {
    const origin = originOf(request);
    const paths = ['/', '/about/', '/docs/getting-started.html', '/docs/unlinked.html'];
    const urls = paths
      .map((path) => `  <url><loc>${origin}${path}</loc><lastmod>2026-10-01</lastmod></url>`)
      .join('\n');
    response
      .writeHead(200, { 'content-type': 'application/xml' })
      .end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  },
};
