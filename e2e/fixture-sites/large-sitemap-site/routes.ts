import type { IncomingMessage } from 'node:http';
import type { FixtureRoutes } from '../../support/fixture-site-server';

// A sitemap index of three sitemaps, 500 posts each: far more than any page budget.

const SITEMAP_COUNT = 3;
const POSTS_PER_SITEMAP = 500;
const originOf = (request: IncomingMessage) => `http://${request.headers.host ?? 'localhost'}`;
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

export const routes: FixtureRoutes = {
  '/sitemap.xml': (request, response) => {
    const sitemaps = Array.from(
      { length: SITEMAP_COUNT },
      (_unused, index) => `  <sitemap><loc>${originOf(request)}/sitemaps/posts-${index + 1}.xml</loc></sitemap>`,
    ).join('\n');
    response
      .writeHead(200, { 'content-type': 'application/xml' })
      .end(`${xml}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps}\n</sitemapindex>\n`);
  },

  '*': (request, response, requestUrl) => {
    const sitemapMatch = /^\/sitemaps\/posts-(\d+)\.xml$/.exec(requestUrl.pathname);
    if (sitemapMatch !== null) {
      const first = (Number(sitemapMatch[1]) - 1) * POSTS_PER_SITEMAP + 1;
      const urls = Array.from(
        { length: POSTS_PER_SITEMAP },
        (_unused, index) => `  <url><loc>${originOf(request)}/posts/${first + index}</loc></url>`,
      ).join('\n');
      response
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(`${xml}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
      return;
    }

    const title = requestUrl.pathname === '/' ? 'Prolific Blog' : `Post ${requestUrl.pathname.split('/').pop()}`;
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>One of very many posts.</p></main></body></html>`);
  },
};
