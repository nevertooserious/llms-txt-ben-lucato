import { readFile } from 'node:fs/promises';
import type { FixtureRoutes } from '../../support/fixture-site-server';

const shell = readFile(new URL('./index.html', import.meta.url));

export const routes: FixtureRoutes = {
  '*': async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(await shell);
  },
};
