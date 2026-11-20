import type { FixtureRoutes } from '../../support/fixture-site-server';

// /catalogue answers every other request with 429 and Retry-After: 1, starting with the
// first, so each crawl meets one 429 and must wait before its retry succeeds.

let catalogueRequestCount = 0;

export const routes: FixtureRoutes = {
  '/catalogue': (_request, response) => {
    catalogueRequestCount += 1;
    if (catalogueRequestCount % 2 === 1) {
      response.writeHead(429, { 'retry-after': '1', 'content-type': 'text/plain' }).end('slow down');
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><html><head><title>Catalogue</title></head><body><h1>Catalogue</h1></body></html>');
  },
};
