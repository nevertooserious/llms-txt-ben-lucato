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
    [stack, browser] = await Promise.all([WebAppStack.start(databaseUrl!), chromium.launch()]);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await stack?.stop();
  });

  beforeEach(async () => {
    site = await stack.startSite('editable-site');
    siteState = initialEditableSiteState();
    editableSiteStates.set(site.port, siteState);
    page = await browser.newPage({
      baseURL: stack.webAppOrigin,
      httpCredentials: { username: 'user1', password: 'pass1' },
    });
  });

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail') console.error(`web app output:\n${stack.webAppLog()}`);
    await page?.close();
    editableSiteStates.delete(site.port);
  });

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
    expect(await page.locator('.hosted-url').innerText()).toContain(hostedPath!);

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
    await stack.databasePool.query(
      `update pipeline_runs set created_at = created_at - interval '1 hour'
        where site_id = (select id from sites where root_url = $1)`,
      [site.origin],
    );

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
    const moveRunsOutOfCooldown = () =>
      stack.databasePool.query(
        `update pipeline_runs set created_at = created_at - interval '1 hour'
          where site_id = (select id from sites where root_url = $1)`,
        [site.origin],
      );

    siteState.pages['/docs/intro']!.description = 'The second version.';
    await moveRunsOutOfCooldown();
    await page.getByRole('button', { name: /check now/i }).click();
    await visible(page.getByText('Version 2', { exact: true }), RUN_TIMEOUT_MS);
    await visible(runStatus('Generated'));

    await page.getByRole('button', { name: 'Make v1 live' }).click();
    await visible(page.getByText('Version 1', { exact: true }));
    await visible(page.getByText(/^Pinned to v1\./));
    // The comparison still offers both versions while the older one is live.
    await visible(page.getByLabel('To version'));
    expect(await page.getByText('There is one version so far.', { exact: false }).count()).toBe(0);
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
    await visible(page.getByText('There is one version so far.', { exact: false }));

    siteState.pages['/docs/intro']!.description = 'Begin here instead.';
    await stack.databasePool.query(
      `update pipeline_runs set created_at = created_at - interval '1 hour'
        where site_id = (select id from sites where root_url = $1)`,
      [site.origin],
    );
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
    expect((await fetch(`${stack.webAppOrigin}/`)).status).toBe(401);
    const wrongLogin = { authorization: `Basic ${Buffer.from('user1:wrong').toString('base64')}` };
    expect((await fetch(`${stack.webAppOrigin}/api/sites/${slug}/versions`, { headers: wrongLogin })).status).toBe(401);

    // The hosted file stays public, because sites proxy their /llms.txt to it.
    expect((await fetch(`${stack.webAppOrigin}/w/${slug}/llms.txt`)).status).toBe(200);
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
