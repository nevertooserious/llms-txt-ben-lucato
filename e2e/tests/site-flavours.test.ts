import { describe, it } from 'vitest';

// End-to-end: submit a fixture site, run crawl -> extract -> generate, and check the
// published llms.txt. One fixture site per case, in e2e/fixture-sites.

describe('rendering', () => {
  it.todo('static page: plain HTTP only, no headless render');
  it.todo('client-side app shell: density check triggers a headless render');
  it.todo('server-rendered metadata with a client-rendered body');
  it.todo('server-rendered and hydrated: no needless headless render');
  it.todo('late-loaded content: no loading placeholder in the output');
  it.todo('hash routing: handled cleanly as a known limitation');
});

describe('discovery', () => {
  it.todo('seeds from a sitemap');
  it.todo('crawls from navigation when there is no sitemap');
  it.todo('respects the page budget on a large sitemap index');
  it.todo('never fetches paths disallowed by robots.txt');
  it.todo('seeds from an existing llms.txt');
  it.todo('links .md variants where they exist');
  it.todo('stays under a subpath root_url');
});

describe('site shapes', () => {
  it.todo('docs site: docs, api and guide sections');
  it.todo('small marketing site');
  it.todo('blog-heavy site: posts do not crowd out core pages');
  it.todo('collapses locale duplicates');
  it.todo('leaves out pagination pages');
  it.todo('one entry per canonical URL');
  it.todo('generates and caches descriptions for pages without one');
});

describe('hostile and broken input', () => {
  it.todo('blocks redirects to private addresses, for plain HTTP and headless');
  it.todo('blocks private-address subresources in the headless browser');
  it.todo('survives malformed HTML, wrong charsets and huge pages');
  it.todo('skips non-HTML responses');
  it.todo('survives timeouts and 5xx without removing pages');
  it.todo('backs off on 429 and honours Retry-After');
  it.todo('fails clearly behind a login wall or bot challenge');
});

describe('monitoring over time', () => {
  it.todo('no change: no new version and no LLM call');
  it.todo('noise-only change: no new version');
  it.todo('title or description change: new version, only that entry regenerated');
  it.todo('new page: entry added');
  it.todo('404 once keeps the page; 404 twice removes it');
  it.todo('a page the crawl did not reach is not removed');
  it.todo('stable digest when fetch method would differ between checks');
  it.todo('user overrides survive an upstream change');
});
