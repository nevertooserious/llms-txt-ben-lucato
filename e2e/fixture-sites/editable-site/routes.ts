import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FixtureRoutes } from '../../support/fixture-site-server';

// A site that changes between checks, for the pipeline tests in site-flavours.test.ts.
// Unlike changing-site, whose one state follows monitor.test.ts through a site's whole
// life, every page here comes from `editableSiteStates`, keyed by the port the copy is
// served on, so each test starts a fresh copy and edits it: change a description, add a
// page, make one answer 404 or 500.
//
// Responses carry an ETag and answer a matching If-None-Match with 304, as static servers
// do, so re-checks exercise conditional GETs. The homepage's <nav> links every page that
// answers 200, so a page that starts answering 404 is also no longer linked.

export interface EditablePage {
  title: string;
  /** Null: no meta description, so the extractor falls back to the first paragraph. */
  description: string | null;
  /** HTML inside <main>, after the H1. */
  body: string;
  /** Answered instead of the page. Defaults to 200. */
  httpStatusCode?: number;
  /** Left out of the homepage's navigation, though it still answers. */
  isUnlinked?: boolean;
}

export interface EditableSiteState {
  /** Path -> page. '/' is the homepage. */
  pages: Record<string, EditablePage>;
  /** 304s sent, to show re-checks use conditional GETs. */
  notModifiedResponseCount: number;
}

export const editableSiteStates = new Map<number, EditableSiteState>();

export function initialEditableSiteState(): EditableSiteState {
  return {
    notModifiedResponseCount: 0,
    pages: {
      '/': { title: 'Editable Co', description: 'A site that changes between checks.', body: '<p>Welcome.</p>' },
      '/docs/intro': { title: 'Intro', description: 'Start here.', body: '<p>How to begin.</p>' },
      '/docs/setup': { title: 'Setup', description: 'Install it.', body: '<p>Run the installer.</p>' },
      '/blog/hello': { title: 'Hello world', description: 'Our first post.', body: '<p>Hello.</p>' },
      '/pricing': { title: 'Pricing', description: 'Plans and prices.', body: '<p>Free for small teams.</p>' },
      '/about': {
        title: 'About us',
        description: null,
        body:
          '<p>We are a small team that builds tools for watching websites change over time.</p>' +
          '<p>Updated 3 days ago. 1,204 visitors this week.</p>',
      },
    },
  };
}

function render(state: EditableSiteState, path: string, page: EditablePage): string {
  const navigation =
    path === '/'
      ? `<nav>${Object.entries(state.pages)
          .filter(([linkedPath, linked]) => linkedPath !== '/' && (linked.httpStatusCode ?? 200) === 200 && !linked.isUnlinked)
          .map(([linkedPath, linked]) => `<a href="${linkedPath}">${linked.title}</a>`)
          .join(' ')}</nav>`
      : '<nav><a href="/">Home</a></nav>';
  const description = page.description === null ? '' : `<meta name="description" content="${page.description}">`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${page.title}</title>${description}</head>` +
    `<body>${navigation}<main><h1>${page.title}</h1>${page.body}</main></body></html>`
  );
}

function notFound(response: ServerResponse): void {
  response.writeHead(404, { 'content-type': 'text/html' }).end('<!doctype html><title>Not found</title>');
}

function serve(request: IncomingMessage, response: ServerResponse, requestUrl: URL): void {
  const state = editableSiteStates.get(request.socket.localPort ?? 0);
  const page = state?.pages[requestUrl.pathname];
  if (state === undefined || page === undefined) { notFound(response); return; }

  const status = page.httpStatusCode ?? 200;
  if (status !== 200) {
    response.writeHead(status, { 'content-type': 'text/html' }).end(`<!doctype html><title>${status}</title>`);
    return;
  }
  const body = render(state, requestUrl.pathname, page);
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;
  if (request.headers['if-none-match'] === etag) {
    state.notModifiedResponseCount += 1;
    response.writeHead(304, { etag }).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html', etag }).end(body);
}

export const routes: FixtureRoutes = { '*': serve };
