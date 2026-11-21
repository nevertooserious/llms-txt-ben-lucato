import type { FixtureRoutes } from '../../support/fixture-site-server';

// robots.txt asks for a second between requests. Every page links to the next, so the
// crawl would go on for ever if the time limit did not stop it.

export const routes: FixtureRoutes = {
  '/robots.txt': (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nCrawl-delay: 1\n');
  },
  '*': (_request, response, requestUrl) => {
    if (requestUrl.pathname !== '/' && !/^\/page-\d+$/.test(requestUrl.pathname)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const current = requestUrl.pathname === '/' ? 0 : Number(requestUrl.pathname.slice('/page-'.length));
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><title>Page ${current}</title><a href="/page-${current + 1}">Next</a>`);
  },
};
