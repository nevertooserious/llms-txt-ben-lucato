import { listedEntries, validateLlmsTxt } from '@llms-txt/generator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  editableSiteStates,
  initialEditableSiteState,
  type EditableSiteState,
} from '../fixture-sites/editable-site/routes';
import type { FixtureSite } from '../support/fixture-site-server';
import { databaseUrl, PipelineHarness, urlOf, type SubmittedSite } from '../support/pipeline-harness';

// End-to-end: submit a fixture site through the queue, let the real worker run crawl ->
// extract -> generate -> publish, and check the published llms.txt and what was stored.
// One fixture site per case, in e2e/fixture-sites. The crawler-level versions of the
// rendering, discovery and hostile-input cases are in crawler.test.ts.
//
// The tests share one worker, whose queue is in its own pg-boss schema (see
// pipeline-harness.ts) so monitor.test.ts's worker never takes these jobs.

if (databaseUrl === null) {
  console.warn('site-flavours.test.ts: DATABASE_URL is not set, so the pipeline tests are skipped.');
}

let harness: PipelineHarness;

beforeAll(async () => {
  if (databaseUrl !== null) harness = await PipelineHarness.start();
}, 30_000);

afterAll(async () => {
  await harness?.stop();
});

/** Submits a fresh copy of a fixture site and returns it with its published file. */
async function generate(siteName: string, rootPath = ''): Promise<SubmittedSite & { llmsTxt: string }> {
  const site = await harness.startSite(siteName);
  const submitted = await harness.submit(site, rootPath);
  expect(submitted.firstRun, submitted.firstRun.errorMessage ?? undefined).toMatchObject({ status: 'succeeded' });
  const llmsTxt = (await harness.publishedLlmsTxt(submitted))!;
  expect(validateLlmsTxt(llmsTxt)).toEqual({ isValid: true, problems: [] });
  return { ...submitted, llmsTxt };
}

/** Section name -> the URLs listed under it, in order. */
function sections(llmsTxt: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of llmsTxt.split('\n')) {
    if (line.startsWith('## ')) result[(current = line.slice(3))] = [];
    else if (current !== null) {
      const url = [...listedEntries(line).keys()][0];
      if (url !== undefined) result[current]!.push(url);
    }
  }
  return result;
}

const listedUrls = (llmsTxt: string) => [...listedEntries(llmsTxt).keys()];
const entryFor = (llmsTxt: string, url: string) => listedEntries(llmsTxt).get(url);

describe.skipIf(databaseUrl === null)('the pipeline', () => {
  describe('rendering', () => {
    it('static page: plain HTTP only, no headless render', async () => {
      const result = await generate('static-site');
      const { site, llmsTxt } = result;
      expect(llmsTxt.startsWith('# Static Fixture Co\n\n> A server-rendered site with no JavaScript')).toBe(true);
      expect(sections(llmsTxt).About).toEqual([`${site.origin}/about/`]);
      expect(sections(llmsTxt).Guides).toEqual([`${site.origin}/docs/getting-started.html`]);
      expect(sections(llmsTxt).Docs).toEqual([`${site.origin}/docs/unlinked.html`]);
      // The site name most titles carry is dropped from entries.
      expect(llmsTxt).toMatch(/- \[Getting started\]\(/);
      expect(await harness.requiresHeadlessRendering(result)).toBe(false);
      expect((await harness.storedPage(result, '/about'))?.fetch_method).toBe('plain_http');
    });

    it('client-side app shell: density check triggers a headless render', async () => {
      const result = await generate('client-app-shell');
      const { site, llmsTxt } = result;
      expect(await harness.requiresHeadlessRendering(result)).toBe(true);
      expect(llmsTxt.startsWith('# Shellfish Analytics\n')).toBe(true);
      expect(entryFor(llmsTxt, `${site.origin}/features`)).toMatch(/^- \[Features\]/);
      expect(entryFor(llmsTxt, `${site.origin}/pricing`)).toMatch(/^- \[Pricing\]/);
      expect(sections(llmsTxt).Pricing).toEqual([`${site.origin}/pricing`]);
    });

    it('server-rendered metadata with a client-rendered body', async () => {
      // One page, so there is nothing to list: the run reads it, then says so.
      const result = await harness.submit(await harness.startSite('metadata-ssr-site'));
      expect(result.firstRun).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('No page besides the homepage') });
      expect(await harness.storedPage(result, '/')).toMatchObject({ fetch_method: 'headless_browser', extracted_title: 'Halfway Studio' });
    });

    it('server-rendered and hydrated: no needless headless render', async () => {
      const result = await generate('hydrated-site');
      expect(await harness.requiresHeadlessRendering(result)).toBe(false);
      expect(listedUrls(result.llmsTxt)).toEqual(
        expect.arrayContaining([`${result.site.origin}/blog/`, `${result.site.origin}/pricing/`]),
      );
    });

    it('late-loaded content: no loading placeholder in the output', async () => {
      const result = await generate('client-app-shell');
      expect(result.llmsTxt).not.toContain('Loading…');
      const home = await harness.databasePool.query<{ content_markdown: string }>(
        'select content_markdown from pages where site_id = $1 and normalised_url = $2',
        [result.siteId, result.site.origin],
      );
      expect(home.rows[0]?.content_markdown).toContain('scheduled reports now arrive');
    });

    it('client-rendered section of a server-rendered site is rendered and listed', async () => {
      const result = await generate('mixed-site');
      expect(await harness.requiresHeadlessRendering(result)).toBe(false);
      expect((await harness.storedPage(result, '/app'))?.fetch_method).toBe('headless_browser');
      expect(result.llmsTxt).toMatch(new RegExp(`- \\[Dashboard\\]\\(${result.site.origin}/app/?\\)`));
    });

    it('hash routing: fails clearly as a known limitation, and publishes nothing', async () => {
      const result = await harness.submit(await harness.startSite('hash-routing-site'));
      expect(result.firstRun).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('URL fragment') });
      expect(await harness.publishedLlmsTxt(result)).toBeNull();
      expect(await harness.storedPagePaths(result)).toEqual(['/']);
    });
  });

  describe('discovery', () => {
    it('seeds from a sitemap', async () => {
      const result = await generate('static-site');
      expect(listedUrls(result.llmsTxt)).toContain(`${result.site.origin}/docs/unlinked.html`);
      expect((await harness.storedPage(result, '/docs/unlinked.html'))?.discovered_via).toBe('sitemap');
    });

    it('crawls from navigation when there is no sitemap', async () => {
      const result = await generate('hydrated-site');
      expect((await harness.storedPage(result, '/pricing'))?.discovered_via).toBe('navigation');
    });

    it('respects the page budget on a large sitemap index', async () => {
      const result = await generate('large-sitemap-site');
      // The harness's budget is 30 pages.
      expect((await harness.storedPagePaths(result)).length).toBeLessThanOrEqual(30);
      expect(result.site.requestLog.filter((path) => /^\/posts\/\d+$/.test(path)).length).toBeLessThanOrEqual(30);
    });

    it('never fetches paths disallowed by robots.txt', async () => {
      const result = await generate('static-site');
      expect(result.llmsTxt).not.toContain('/private/');
      expect(result.site.requestLog.filter((path) => path.startsWith('/private/'))).toEqual([]);
    });

    it('seeds from an existing llms.txt', async () => {
      const result = await generate('markdown-site');
      expect((await harness.storedPage(result, '/guides/setup'))?.discovered_via).toBe('existing_llms_txt');
      expect(result.llmsTxt).not.toContain('example.com/not-in-scope');
    });

    it('links .md variants where they exist', async () => {
      const { site, llmsTxt } = await generate('markdown-site');
      expect(listedUrls(llmsTxt)).toEqual(
        expect.arrayContaining([`${site.origin}/guides/intro.md`, `${site.origin}/guides/setup.md`, `${site.origin}/guides/no-markdown`]),
      );
    });

    it('lists the site’s machine-readable files in a section of their own', async () => {
      const { site, llmsTxt } = await generate('markdown-site');
      expect(sections(llmsTxt)['Machine-readable resources']).toEqual([`${site.origin}/llms-full.txt`, `${site.origin}/api/openapi.json`]);
    });

    it('stays under a subpath root_url', async () => {
      const result = await generate('static-site', '/docs');
      expect(listedUrls(result.llmsTxt).every((url) => url.startsWith(`${result.site.origin}/docs/`))).toBe(true);
      expect(listedUrls(result.llmsTxt).length).toBeGreaterThan(0);
    });
  });

  describe('site shapes', () => {
    it('blog-heavy site: posts are capped, and the overflow is left out', async () => {
      const { llmsTxt } = await generate('large-sitemap-site');
      const listed = sections(llmsTxt);
      expect(Object.keys(listed)).toEqual(['Blog']);
      expect(listed.Blog).toHaveLength(3);
      // Numbered URLs sort as numbers when nothing else tells them apart.
      expect(listed.Blog![0]).toMatch(/\/posts\/1$/);
      expect(listed.Blog![1]).toMatch(/\/posts\/2$/);
    });

    it('leaves out pages with a noindex directive', async () => {
      const { site, llmsTxt } = await generate('conventions-site');
      expect(listedUrls(llmsTxt)).toContain(`${site.origin}/slash-only/`);
      expect(llmsTxt).not.toContain('/noindex-page');
    });

    it.todo('docs site: docs, api and guide sections');
    it.todo('collapses locale duplicates');
    it.todo('one entry per canonical URL');
    it.todo('generates and caches descriptions for pages without one (needs the LLM client)');
  });

  describe('hostile and broken input', () => {
    it('fails clearly when robots.txt is unreachable, and publishes nothing', async () => {
      const site = await harness.startSite('robots-unreachable-site');
      const submitted = await harness.submit(site);
      expect(submitted.firstRun).toMatchObject({ status: 'failed', errorMessage: expect.stringMatching(/robots\.txt/) });
      expect(await harness.publishedLlmsTxt(submitted)).toBeNull();
    });

    it('fails clearly when the homepage redirects to a private address', async () => {
      const site = await harness.startSite('hostile-site');
      const submitted = await harness.submit(site, `/redirect?to=${encodeURIComponent('http://169.254.169.254/')}`);
      expect(submitted.firstRun).toMatchObject({ status: 'failed', errorMessage: 'No page of the site could be fetched.' });
      expect(await harness.publishedLlmsTxt(submitted)).toBeNull();
    });

    it('backs off on 429 and honours Retry-After', async () => {
      const { site, llmsTxt } = await generate('rate-limited-site');
      expect(listedUrls(llmsTxt)).toContain(`${site.origin}/catalogue`);
    });

    it('survives timeouts and 5xx without removing pages', async () => {
      const { submitted, state } = await submitEditableSite();
      state.pages['/docs/setup']!.httpStatusCode = 500;
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'unchanged', pagesFailedCount: 1 });
      expect((await harness.storedPage(submitted, '/docs/setup'))?.removed_at).toBeNull();
      expect(listedUrls((await harness.publishedLlmsTxt(submitted))!)).toContain(urlOf(submitted.site, '/docs/setup'));
    });

    it('fails the run and keeps the published file when most fetches fail', async () => {
      const { submitted, state } = await submitEditableSite();
      for (const path of ['/docs/intro', '/docs/setup', '/blog/hello', '/pricing', '/about']) {
        state.pages[path]!.httpStatusCode = 503;
      }
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'failed', errorMessage: expect.stringMatching(/fetches failed/) });
      expect(await harness.versions(submitted)).toHaveLength(1);
    });

    it.todo('fails clearly behind a login wall or bot challenge');
  });

  describe('monitoring over time', () => {
    it('no change: no new version, and re-checks are conditional GETs', async () => {
      const { submitted, state } = await submitEditableSite();
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'unchanged', pagesChangedCount: 0 });
      expect(await harness.versions(submitted)).toHaveLength(1);
      expect(state.notModifiedResponseCount).toBeGreaterThan(0);
    });

    it('noise-only change: no new version', async () => {
      const { submitted, state } = await submitEditableSite();
      state.pages['/about']!.body = state.pages['/about']!.body.replace('3 days ago. 1,204', '5 days ago. 1,377');
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'unchanged', pagesChangedCount: 0 });
      expect(await harness.versions(submitted)).toHaveLength(1);
    });

    it('description change: new version, only that entry changed', async () => {
      const { submitted, state } = await submitEditableSite();
      state.pages['/docs/setup']!.description = 'Install it in one command.';
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded', pagesChangedCount: 1 });
      const versions = await harness.versions(submitted);
      expect(versions.map((version) => version.version_number)).toEqual([1, 2]);
      expect(versions[1]!.page_changes).toEqual({ added: [], removed: [], changed: [urlOf(submitted.site, '/docs/setup')] });
      expect(await harness.publishedLlmsTxt(submitted)).toContain('): Install it in one command.');
    });

    it('new page: entry added', async () => {
      const { submitted, state } = await submitEditableSite();
      state.pages['/docs/advanced'] = { title: 'Advanced', description: 'For experts.', body: '<p>Deep things.</p>' };
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded' });
      const versions = await harness.versions(submitted);
      expect(versions.at(-1)!.page_changes).toEqual({ added: [urlOf(submitted.site, '/docs/advanced')], removed: [], changed: [] });
    });

    it('404 once keeps the page; 404 twice removes it', async () => {
      const { submitted, state } = await submitEditableSite();
      const url = urlOf(submitted.site, '/blog/hello');
      state.pages['/blog/hello']!.httpStatusCode = 404;

      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'unchanged' });
      expect(await harness.storedPage(submitted, '/blog/hello')).toMatchObject({ consecutive_not_found_count: 1, removed_at: null });
      expect(listedUrls((await harness.publishedLlmsTxt(submitted))!)).toContain(url);

      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded' });
      expect((await harness.storedPage(submitted, '/blog/hello'))?.removed_at).not.toBeNull();
      expect(listedUrls((await harness.publishedLlmsTxt(submitted))!)).not.toContain(url);
      expect((await harness.versions(submitted)).at(-1)!.page_changes).toEqual({ added: [], removed: [url], changed: [] });
    });

    it('a removed page that answers again is listed again', async () => {
      const { submitted, state } = await submitEditableSite();
      state.pages['/blog/hello']!.httpStatusCode = 404;
      await harness.checkNow(submitted);
      await harness.checkNow(submitted);
      delete state.pages['/blog/hello']!.httpStatusCode;
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded' });
      expect(await harness.storedPage(submitted, '/blog/hello')).toMatchObject({ consecutive_not_found_count: 0, removed_at: null });
      expect(listedUrls((await harness.publishedLlmsTxt(submitted))!)).toContain(urlOf(submitted.site, '/blog/hello'));
    });

    it('a page nothing links to any more is re-checked, not removed', async () => {
      const { submitted, state } = await submitEditableSite();
      state.pages['/pricing']!.isUnlinked = true;
      const run = await harness.checkNow(submitted);
      expect(run.status).not.toBe('failed');
      expect((await harness.storedPage(submitted, '/pricing'))?.removed_at).toBeNull();
      expect(listedUrls((await harness.publishedLlmsTxt(submitted))!)).toContain(urlOf(submitted.site, '/pricing'));
    });

    it('user overrides survive an upstream change', async () => {
      const { submitted, state } = await submitEditableSite();
      await harness.setOverride(submitted, '/docs/setup', { descriptionOverride: 'Our own words.' });
      await harness.setOverride(submitted, '/pricing', { isExcluded: true });
      state.pages['/docs/setup']!.description = 'Upstream rewrote this.';

      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded' });
      const llmsTxt = (await harness.publishedLlmsTxt(submitted))!;
      expect(entryFor(llmsTxt, urlOf(submitted.site, '/docs/setup'))).toBe(
        `- [Setup](${urlOf(submitted.site, '/docs/setup')}): Our own words.`,
      );
      expect(llmsTxt).not.toContain('Upstream rewrote this.');
      expect(listedUrls(llmsTxt)).not.toContain(urlOf(submitted.site, '/pricing'));
    });

    it('an ignored path keeps out its pages, and the ones a later check finds under it', async () => {
      const { submitted, state } = await submitEditableSite();
      await harness.setExcludedPaths(submitted, ['/docs']);
      state.pages['/docs/upgrade'] = { title: 'Upgrade', description: 'Move to the new version.', body: '<p>Steps.</p>' };
      state.pages['/docs-archive'] = { title: 'Old docs', description: 'Earlier versions.', body: '<p>Kept for reference.</p>' };

      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded' });
      // The crawl still stores the pages: ignoring is a choice about the file, not the crawl.
      expect(await harness.storedPage(submitted, '/docs/upgrade')).toMatchObject({ http_status_code: 200, removed_at: null });
      const listed = listedUrls((await harness.publishedLlmsTxt(submitted))!);
      expect(listed.filter((url) => url.startsWith(urlOf(submitted.site, '/docs/')))).toEqual([]);
      expect(listed).toContain(urlOf(submitted.site, '/docs-archive'));
      expect(listed).toContain(urlOf(submitted.site, '/pricing'));

      // No longer ignored, they are all listed by the next check.
      await harness.setExcludedPaths(submitted, []);
      state.pages['/pricing']!.description = 'New prices.';
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded' });
      const listedAgain = listedUrls((await harness.publishedLlmsTxt(submitted))!);
      for (const path of ['/docs/intro', '/docs/setup', '/docs/upgrade']) expect(listedAgain).toContain(urlOf(submitted.site, path));
    });

    it('a second submission of the same URL gets its own site and file', async () => {
      const { submitted } = await submitEditableSite();
      await harness.setOverride(submitted, '/pricing', { isExcluded: true });
      const second = await harness.submit(submitted.site);
      expect(second.siteId).not.toBe(submitted.siteId);
      expect(second.firstRun.status).toBe('succeeded');
      expect(listedUrls((await harness.publishedLlmsTxt(second))!)).toContain(urlOf(submitted.site, '/pricing'));
      expect(await harness.checkNow(submitted)).toMatchObject({ status: 'succeeded' });
      expect(listedUrls((await harness.publishedLlmsTxt(second))!)).toContain(urlOf(submitted.site, '/pricing'));
      expect(listedUrls((await harness.publishedLlmsTxt(submitted))!)).not.toContain(urlOf(submitted.site, '/pricing'));
    });

    it.todo('stable digest when fetch method would differ between checks');
  });
});

/** A fresh copy of editable-site, submitted and published once. Its state is the test's to edit. */
async function submitEditableSite(): Promise<{ submitted: SubmittedSite; state: EditableSiteState; site: FixtureSite }> {
  const site = await harness.startSite('editable-site');
  const state = initialEditableSiteState();
  editableSiteStates.set(site.port, state);
  const submitted = await harness.submit(site);
  expect(submitted.firstRun, submitted.firstRun.errorMessage ?? undefined).toMatchObject({ status: 'succeeded' });
  const llmsTxt = (await harness.publishedLlmsTxt(submitted))!;
  expect(llmsTxt).toContain('# Editable Co\n\n> A site that changes between checks.');
  expect(listedUrls(llmsTxt)).toHaveLength(5);
  return { submitted, state, site };
}
