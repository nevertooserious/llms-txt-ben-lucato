import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  editableSiteStates,
  initialEditableSiteState,
  type EditableSiteState,
} from '../fixture-sites/editable-site/routes';
import type { FixtureSite } from '../support/fixture-site-server';
import { WebAppStack } from '../support/web-app-stack';

// User flows driven through a real browser: headless Chromium clicks through the web app
// (`next dev`), which queues runs that the real worker crawls against a local fixture
// site. Nothing is called directly except where a user would have to wait: a run's
// "check now" cooldown is skipped by moving the last run back in time.
//
// Needs DATABASE_URL (see e2e/support/web-app-stack.ts). Skipped locally without it.

const databaseUrl = process.env.DATABASE_URL;
if (process.env.CI && !databaseUrl) throw new Error('DATABASE_URL must be set in CI for the browser end-to-end tests');

/** Waits for the element to be shown; fails the test if it is not within the timeout. */
const visible = (locator: Locator, timeout = 10_000) => locator.waitFor({ state: 'visible', timeout });

/** How long a crawl of editable-site, plus polling, may take to show up in the page. */
const RUN_TIMEOUT_MS = 45_000;

describe.skipIf(!databaseUrl)('the web app in a browser', () => {
  let stack: WebAppStack;
  let browser: Browser;
  let page: Page;
  let site: FixtureSite;
  let siteState: EditableSiteState;

  beforeAll(async () => {
    // One after the other, so that if either fails afterAll still stops the one that started.
    browser = await chromium.launch();
    stack = await WebAppStack.start(databaseUrl!);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await stack?.stop();
  });

  beforeEach(async () => {
    site = await stack.startSite('editable-site');
    siteState = initialEditableSiteState();
    editableSiteStates.set(site.port, siteState);
    page = await browser.newPage({ baseURL: stack.webAppOrigin });
    await signIn();
  });

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail') console.error(`web app output:\n${stack.webAppLog()}`);
    await page?.close();
    editableSiteStates.delete(site.port);
  });

  /** Fills in the login form. The page must already be showing it. */
  async function submitLogin(password = 'pass1'): Promise<void> {
    await page.getByLabel('Username').fill('user1');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  /** A signed-out visit to the home page lands on the login page; signing in leads back. */
  async function signIn(): Promise<void> {
    await page.goto('/');
    await page.waitForURL('/login');
    await submitLogin();
    await page.waitForURL('/');
  }

  /** Skips the "check now" cooldown, which counts from the site's last run. */
  const moveRunsOutOfCooldown = () =>
    stack.databasePool.query(
      `update pipeline_runs set created_at = created_at - interval '1 hour'
        where site_id = (select id from sites where root_url = $1)`,
      [site.origin],
    );

  const runStatus = (text: string) => page.locator('.status-line').getByText(text, { exact: true });

  /** From the home page: type the site's URL, press Generate, wait for the first version. */
  async function generateFromHomePage(): Promise<void> {
    await page.goto('/');
    await page.getByLabel('Website URL').fill(site.origin);
    await page.getByRole('button', { name: 'Generate' }).click();

    await page.waitForURL(/\/w\/[^/]+$/);
    await visible(runStatus('Generated'), RUN_TIMEOUT_MS);
    await visible(page.getByText('Version 1', { exact: true }));
  }

  /** The site screen's heading is the site's URL; the preview below it has an H1 of its own. */
  const siteHeading = () =>
    page.locator('.site-heading').getByRole('heading', { level: 1, name: new RegExp(site.origin.replace(/[.]/g, '\\.')) });

  const rawLink = () => page.getByRole('link', { name: 'Raw', exact: true });

  /** The file behind the "Raw" link. */
  async function rawLlmsTxt(): Promise<string> {
    const rawPath = await rawLink().getAttribute('href');
    return (await page.request.get(rawPath!)).text();
  }

  it('refuses a wrong password, returns to the page asked for, and signs out', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/login');

    // A page asked for while signed out comes back after the login.
    await page.goto('/w/no-such-site?from=test');
    await page.waitForURL('/login?next=%2Fw%2Fno-such-site%3Ffrom%3Dtest');
    await visible(page.getByRole('heading', { level: 2, name: 'Sign in' }));

    await submitLogin('wrong');
    await visible(page.getByRole('alert').getByText('That username or password is not right.'));

    await submitLogin();
    await page.waitForURL('/w/no-such-site?from=test');

    // Signed out, the API refuses the browser without asking it to show its own prompt.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/login');
    const refused = await page.evaluate(async () => {
      const response = await fetch('/api/sites/no-such-site');
      return { status: response.status, challenge: response.headers.get('www-authenticate') };
    });
    expect(refused).toEqual({ status: 401, challenge: null });
  });

  it('opens the API docs from the nav, only when signed in', async () => {
    await page.getByRole('link', { name: 'API docs' }).click();
    await page.waitForURL('/api-docs');
    await visible(page.getByRole('heading', { name: /llms\.txt generator API/ }), 30_000);
    await visible(page.locator('.opblock-summary-path', { hasText: '/api/sites/{publicSlug}/pages' }).first());

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/login');
    expect(await page.getByRole('link', { name: 'API docs' }).count()).toBe(0);
    await page.goto('/api-docs');
    await page.waitForURL('/login?next=%2Fapi-docs');
  });

  it('generates an llms.txt for a new site', async () => {
    await generateFromHomePage();

    // The screen shows the site, the finished run and the file.
    await visible(siteHeading());
    await visible(page.locator('.facts').getByText('First generation', { exact: true }));
    await visible(page.getByText('✓ Valid per spec'));
    const preview = page.locator('article.preview');
    await visible(preview.getByRole('heading', { level: 2, name: 'Docs' }));
    expect(await preview.getByRole('link', { name: 'Intro' }).getAttribute('href')).toBe(`${site.origin}/docs/intro`);

    const llmsTxt = await rawLlmsTxt();
    expect(llmsTxt).toContain('# Editable Co\n\n> A site that changes between checks.');
    expect(llmsTxt).toContain(`- [Intro](${site.origin}/docs/intro): Start here.`);

    // The raw file is a link, not shown on the page, and is served as plain text.
    expect(await page.locator('pre.raw-text').count()).toBe(0);
    const hostedPath = await rawLink().getAttribute('href');
    const hosted = await page.request.get(hostedPath!);
    expect(hosted.headers()['content-type']).toContain('text/plain');

    // The home page now lists the site in its table, linking back to its screen.
    await page.goto('/');
    await visible(page.getByRole('row', { name: new RegExp(site.origin.replace(/[.]/g, '\\.')) }).getByText('Generated'));
    await page.getByRole('link', { name: new RegExp(site.origin.replace(/[.]/g, '\\.')) }).click();
    await visible(siteHeading());
  });

  it('regenerates the file when the user presses "Check now"', async () => {
    await generateFromHomePage();
    const checkNow = page.getByRole('button', { name: /check now/i });

    // Straight after the first run, the cooldown refuses another and says so.
    await checkNow.click();
    await visible(page.getByText('This site was checked a moment ago. Try again later.'));

    // The site changes, and the cooldown passes.
    siteState.pages['/docs/intro']!.description = 'Begin here instead.';
    await moveRunsOutOfCooldown();

    await checkNow.click();
    await visible(page.locator('.facts').getByText('Manual check', { exact: true }));
    await visible(page.getByText('Version 2', { exact: true }), RUN_TIMEOUT_MS);
    await visible(runStatus('Generated'));
    expect(await rawLlmsTxt()).toContain(`- [Intro](${site.origin}/docs/intro): Begin here instead.`);
  });

  it('makes an older version live, keeps it through a check, and follows the latest again', async () => {
    await generateFromHomePage();
    const hostedPath = await rawLink().getAttribute('href');
    const firstVersion = await (await page.request.get(hostedPath!)).text();

    siteState.pages['/docs/intro']!.description = 'The second version.';
    await moveRunsOutOfCooldown();
    await page.getByRole('button', { name: /check now/i }).click();
    await visible(page.getByText('Version 2', { exact: true }), RUN_TIMEOUT_MS);
    await visible(runStatus('Generated'));

    await page.getByRole('button', { name: 'Make v1 live' }).click();
    await visible(page.getByText('Version 1', { exact: true }));
    await visible(page.locator('.version-row', { hasText: 'v1' }).getByText('Pinned', { exact: true }));
    // The comparison still offers both versions while the older one is live.
    await visible(page.getByLabel('To version'));
    expect(await page.getByText('Comparison is available once', { exact: false }).count()).toBe(0);
    expect(await (await page.request.get(hostedPath!)).text()).toBe(firstVersion);

    // A later check records a version without publishing it.
    siteState.pages['/docs/intro']!.description = 'The third version.';
    await moveRunsOutOfCooldown();
    await page.getByRole('button', { name: /check now/i }).click();
    await visible(page.getByRole('button', { name: 'Make v3 live' }), RUN_TIMEOUT_MS);
    expect(await (await page.request.get(hostedPath!)).text()).toBe(firstVersion);

    await page.getByRole('button', { name: 'Follow latest' }).click();
    await visible(page.getByText('Version 3', { exact: true }));
    expect(await (await page.request.get(hostedPath!)).text()).toContain('The third version.');
  });

  it('compares two versions of the file', async () => {
    await generateFromHomePage();
    await visible(page.getByText('Comparison is available once', { exact: false }));

    siteState.pages['/docs/intro']!.description = 'Begin here instead.';
    await moveRunsOutOfCooldown();
    await page.getByRole('button', { name: /check now/i }).click();
    await visible(page.getByText('Version 2', { exact: true }), RUN_TIMEOUT_MS);

    // It opens on the two newest versions.
    const removedLine = page.locator('tr.diff-removed', { hasText: 'Start here.' });
    const addedLine = page.locator('tr.diff-added', { hasText: 'Begin here instead.' });
    await visible(removedLine);
    await visible(addedLine);
    expect(await page.getByLabel('From version').inputValue()).toBe('1');
    expect(await page.getByLabel('To version').inputValue()).toBe('2');

    // A version compared with itself has nothing to show.
    await page.getByLabel('To version').selectOption('1');
    await visible(page.getByText('Pick two different versions to compare.'));

    // The history is available from the API with the login, and not without it.
    const slug = new URL(page.url()).pathname.split('/')[2]!;
    expect((await page.request.get(`/api/sites/${slug}/versions`)).status()).toBe(200);
    expect((await page.request.get(`/api/sites/${slug}/versions/1`)).status()).toBe(200);
    const withoutLogin = await fetch(`${stack.webAppOrigin}/api/sites/${slug}/versions`);
    expect(withoutLogin.status).toBe(401);
    expect(withoutLogin.headers.get('www-authenticate')).toContain('Basic');
    expect(await withoutLogin.json()).toMatchObject({ code: 'unauthorized' });
    // A page without the login goes to the login page.
    const pageWithoutLogin = await fetch(`${stack.webAppOrigin}/w/${slug}`, { redirect: 'manual' });
    expect(pageWithoutLogin.status).toBe(307);
    expect(pageWithoutLogin.headers.get('location')).toBe(`/login?next=%2Fw%2F${slug}`);
    // Only the app's proxy says who is signed in: a client naming a user itself is ignored.
    const forged = { 'x-llms-txt-user-id': '00000000-0000-4000-8000-000000000000' };
    expect((await fetch(`${stack.webAppOrigin}/api/sites`, { headers: forged })).status).toBe(401);
    const wrongLogin = { authorization: `Basic ${Buffer.from('user1:wrong').toString('base64')}` };
    expect((await fetch(`${stack.webAppOrigin}/api/sites/${slug}/versions`, { headers: wrongLogin })).status).toBe(401);

    // The hosted file stays public, because sites proxy their /llms.txt to it.
    expect((await fetch(`${stack.webAppOrigin}/w/${slug}/llms.txt`)).status).toBe(200);
  });

  it('ignores a page and a path, and keeps the path ignored for pages found later', async () => {
    await generateFromHomePage();
    const pagesPanel = page.locator('.pages-panel');
    const pageRow = (path: string) => pagesPanel.locator('.page-row', { has: page.getByText(path, { exact: true }) });

    // The panel opens to the crawled pages, grouped by path, each with the section it is listed under.
    await pagesPanel.getByRole('heading', { name: 'Pages' }).click();
    await visible(pagesPanel.getByText('6 crawled · 5 listed · 0 ignored'));
    await visible(pagesPanel.locator('.page-group-summary', { hasText: '/docs/' }).getByText('2 pages'));
    await visible(pageRow('/docs/intro').getByText('Docs', { exact: true }));
    expect(await pagesPanel.getByRole('checkbox', { name: '/', exact: true }).isDisabled()).toBe(true);
    expect(await pagesPanel.getByRole('checkbox', { name: '/', exact: true }).isChecked()).toBe(true);

    // Nothing changes until it is saved; then one new version leaves the page and the path out.
    await pagesPanel.getByRole('checkbox', { name: '/pricing', exact: true }).uncheck();
    await pagesPanel.getByRole('checkbox', { name: 'Include the path /docs/' }).uncheck();
    await visible(pagesPanel.getByText('2 unsaved changes'));
    await visible(pageRow('/docs/setup').getByText('Path ignored'));
    expect(await rawLlmsTxt()).toContain(`${site.origin}/docs/intro`);

    await pagesPanel.getByRole('button', { name: 'Save and regenerate' }).click();
    await visible(pagesPanel.getByText('Saved. v2 is live.'));
    await visible(page.getByText('Version 2', { exact: true }));
    await visible(pagesPanel.getByText('6 crawled · 2 listed · 3 ignored'));
    const afterSave = await rawLlmsTxt();
    expect(afterSave).not.toContain(`${site.origin}/docs/`);
    expect(afterSave).not.toContain(`${site.origin}/pricing`);
    expect(afterSave).toContain(`${site.origin}/blog/hello`);

    // The site gains a page under the ignored path and one outside it. The next check
    // lists only the one outside.
    siteState.pages['/docs/upgrade'] = { title: 'Upgrade', description: 'Move to the new version.', body: '<p>Steps.</p>' };
    siteState.pages['/changelog'] = { title: 'Changelog', description: 'What changed.', body: '<p>Releases.</p>' };
    await moveRunsOutOfCooldown();
    await page.getByRole('button', { name: /check now/i }).click();
    await visible(page.getByText('Version 3', { exact: true }), RUN_TIMEOUT_MS);
    await visible(pageRow('/docs/upgrade').getByText('Path ignored'));
    const afterCheck = await rawLlmsTxt();
    expect(afterCheck).toContain(`${site.origin}/changelog`);
    expect(afterCheck).not.toContain(`${site.origin}/docs/`);

    // A reload shows what was saved, and ticking the path includes it again.
    await page.reload();
    await page.locator('.pages-panel').getByRole('heading', { name: 'Pages' }).click();
    await page.getByRole('checkbox', { name: 'Include the path /docs/' }).check();
    await page.getByRole('button', { name: 'Save and regenerate' }).click();
    await visible(page.getByText('Saved. v4 is live.'));
    const afterIncluding = await rawLlmsTxt();
    expect(afterIncluding).toContain(`${site.origin}/docs/upgrade`);
    expect(afterIncluding).not.toContain(`${site.origin}/pricing`);

    // The API refuses what is not two lists of URLs, with a stable code.
    const slug = new URL(page.url()).pathname.split('/')[2]!;
    const refused = await page.request.put(`/api/sites/${slug}/pages`, { data: { excludedUrls: [], excludedUrlPrefixes: ['/docs'] } });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('shows no page counts and no way to turn monitoring off', async () => {
    await generateFromHomePage();
    await visible(page.getByText('Next check:'));
    expect(await page.getByRole('switch').count()).toBe(0);
    expect(await page.locator('.counters, .stages').count()).toBe(0);
  });

  it('deletes the site after asking for confirmation', async () => {
    await generateFromHomePage();
    const siteUrl = page.url();
    const hostedPath = await rawLink().getAttribute('href');

    // Cancelling keeps it.
    await page.getByRole('button', { name: 'Delete site' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect((await page.request.get(hostedPath!)).status()).toBe(200);

    await page.getByRole('button', { name: 'Delete site' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    expect((await page.request.get(hostedPath!)).status()).toBe(404);
    expect(await page.getByRole('link', { name: new RegExp(site.origin.replace(/[.]/g, '\\.')) }).count()).toBe(0);
    await page.goto(siteUrl);
    await visible(page.getByRole('heading', { name: 'No site here.' }));
  });
});
