import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';

// Serves one fixture site from e2e/fixture-sites/<name>/ on its own loopback port.
// Files are served as-is; a site's routes.ts can add scripted responses (redirects,
// errors, slow or huge bodies) that static files cannot express.

const FIXTURE_SITES_DIRECTORY = resolve(import.meta.dirname, '../fixture-sites');

// No charset parameter on text/html, so pages that declare one in <meta> are decoded by it.
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

export type FixtureRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
) => void | Promise<void>;

/** Exported as `routes` from a site's routes.ts, keyed by exact path. */
export type FixtureRoutes = Record<string, FixtureRouteHandler>;

export interface FixtureSite {
  /** e.g. http://127.0.0.1:54321 */
  origin: string;
  port: number;
  /** Every request the site received, in order, as path plus query. */
  requestLog: string[];
  close(): Promise<void>;
}

export async function startFixtureSite(siteName: string): Promise<FixtureSite> {
  const siteDirectory = join(FIXTURE_SITES_DIRECTORY, siteName);
  const routes = await loadRoutes(siteDirectory);
  const requestLog: string[] = [];

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://fixture.invalid');
    requestLog.push(requestUrl.pathname + requestUrl.search);
    const route = routes[requestUrl.pathname];
    const handled = route ? route(request, response, requestUrl) : serveFile(siteDirectory, requestUrl, response);
    Promise.resolve(handled).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    requestLog,
    close: () =>
      new Promise((resolveClose) => {
        // Slow routes may hold sockets open; do not wait for them.
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

async function loadRoutes(siteDirectory: string): Promise<FixtureRoutes> {
  const routesPath = join(siteDirectory, 'routes.ts');
  const exists = await stat(routesPath).then(
    () => true,
    () => false,
  );
  if (!exists) return {};
  const routesModule = (await import(routesPath)) as { routes: FixtureRoutes };
  return routesModule.routes;
}

async function serveFile(siteDirectory: string, requestUrl: URL, response: ServerResponse): Promise<void> {
  let relativePath = normalize(decodeURIComponent(requestUrl.pathname));
  if (relativePath.endsWith('/')) relativePath += 'index.html';
  const filePath = join(siteDirectory, relativePath);

  if (!filePath.startsWith(siteDirectory + '/') || filePath.endsWith('routes.ts')) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }

  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch {
    response.writeHead(404, { 'content-type': 'text/html' }).end('<!doctype html><title>Not found</title>');
    return;
  }
  const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
  response.writeHead(200, { 'content-type': contentType, 'content-length': body.length }).end(body);
}
