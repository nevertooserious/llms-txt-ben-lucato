import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { FixtureRoutes } from '../../support/fixture-site-server';

// One route per open convention the crawler must follow: RFC 9309 for robots.txt, the
// sitemaps protocol, RFC 9110 for 503 + Retry-After, and robots directives in headers.

const originOf = (request: IncomingMessage) => `http://${request.headers.host ?? 'localhost'}`;
function html(response: ServerResponse, title: string, body = '', headers: Record<string, string> = {}): void {
  response
    .writeHead(200, { 'content-type': 'text/html', ...headers })
    .end(`<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`);
}

let maintenanceRequestCount = 0;

export const routes: FixtureRoutes = {
  // RFC 9309: a 2xx robots.txt is parsed whatever its media type, even text/html.
  '/robots.txt': (request, response) => {
    const origin = originOf(request);
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end(['User-agent: *', 'Disallow: /private/', '', `Sitemap: ${origin}/sitemap.xml.gz`, `Sitemap: ${origin}/sitemap.txt`, ''].join('\n'));
  },

  // The sitemaps protocol allows gzip...
  '/sitemap.xml.gz': (request, response) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${originOf(request)}/from-gzip-sitemap</loc></url></urlset>`;
    response.writeHead(200, { 'content-type': 'application/gzip' }).end(gzipSync(xml));
  },

  // ...and plain text, one URL per line.
  '/sitemap.txt': (request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' }).end(`${originOf(request)}/from-text-sitemap\n`);
  },

  '/': (_request, response) =>
    html(
      response,
      'Conventions',
      [
        '<a href="/moved">An old URL that now redirects into a disallowed path</a>',
        '<a href="/slash-only/">A page that only exists with its trailing slash</a>',
        '<a href="/nofollow-header">A page whose links must not be followed</a>',
        '<a href="/noindex-page">A page that asks not to be indexed</a>',
        '<a href="/maintenance">A page briefly down for maintenance</a>',
      ].join(' '),
    ),

  '/moved': (_request, response) => {
    response.writeHead(301, { location: '/private/target' }).end();
  },
  '/private/target': (_request, response) => html(response, 'Disallowed target'),

  // Only the URL as linked works; a crawler that strips the slash gets a 404.
  '/slash-only/': (_request, response) => html(response, 'Slash only'),
  '/slash-only': (_request, response) => {
    response.writeHead(404, { 'content-type': 'text/html' }).end('<!doctype html><title>Not found</title>');
  },

  '/nofollow-header': (_request, response) =>
    html(response, 'Nofollow header', '<a href="/only-behind-nofollow">Hidden</a>', { 'x-robots-tag': 'nofollow' }),
  '/only-behind-nofollow': (_request, response) => html(response, 'Only behind nofollow'),

  '/noindex-page': (_request, response) => {
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><html><head><title>Noindex</title><meta name="robots" content="noindex"></head><body><p>Do not list me.</p></body></html>');
  },

  // Every other request is a 503 with Retry-After, starting with the first.
  '/maintenance': (_request, response) => {
    maintenanceRequestCount += 1;
    if (maintenanceRequestCount % 2 === 1) {
      response.writeHead(503, { 'retry-after': '1', 'content-type': 'text/plain' }).end('down for maintenance');
      return;
    }
    html(response, 'Back from maintenance');
  },

  '/from-gzip-sitemap': (_request, response) => html(response, 'From the gzip sitemap'),
  '/from-text-sitemap': (_request, response) => html(response, 'From the text sitemap'),
};
