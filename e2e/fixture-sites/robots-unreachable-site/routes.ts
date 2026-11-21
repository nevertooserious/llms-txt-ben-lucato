import type { FixtureRoutes } from '../../support/fixture-site-server';

// robots.txt answers 500. RFC 9309 says to assume complete disallow, so nothing else on
// this site may be fetched.

export const routes: FixtureRoutes = {
  '/robots.txt': (_request, response) => {
    response.writeHead(500, { 'content-type': 'text/plain' }).end('internal error');
  },
  '*': (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Should not be fetched</title>');
  },
};
