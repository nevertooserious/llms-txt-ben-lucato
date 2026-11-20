import { readFile } from 'node:fs/promises';
import type { FixtureRoutes } from '../../support/fixture-site-server';

// Like a single-page app's server: any path that is not a file gets the app shell.

const shell = readFile(new URL('./index.html', import.meta.url));

export const routes: FixtureRoutes = {
  '*': async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(await shell);
  },
};
