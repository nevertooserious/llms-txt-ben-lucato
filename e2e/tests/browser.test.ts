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
    page = await browser.newPage({ baseURL: stack.webAppOrigin });
  });

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail') console.error(`web app output:\n${stack.webAppLog()}`);
    await page?.close();
    editableSiteStates.delete(site.port);
  });

  /** From the home page: type the site's URL, press Generate, wait for the first version. */
  async function generateFromHomePage(): Promise<void> {
    await page.goto('/');
    await page.getByLabel('Website URL').fill(site.origin);
    await page.getByRole('button', { name: 'Generate' }).click();

    await page.waitForURL(/\/w\/[^/]+#token=/);
    await visible(page.getByText('Published a new version'), RUN_TIMEOUT_MS);
    await visible(page.getByText('Version 1', { exact: true }));
  }

  /** The workspace's heading; the preview below it has an H1 of its own. */
  const siteHeading = () => page.locator('.site-heading').getByRole('heading', { level: 1, name: 'Editable Co' });

  async function rawLlmsTxt(): Promise<string> {
    await page.getByRole('tab', { name: 'Raw' }).click();
    return page.locator('pre.raw-text').innerText();
  }

  it('generates an llms.txt for a new site', async () => {
    await generateFromHomePage();

    // The workspace shows the site, the finished run and the file.
    await visible(siteHeading());
    await visible(page.getByText(/First generation ·/));
    await visible(page.getByText('✓ Valid per spec'));
    const preview = page.locator('article.preview');
    await visible(preview.getByRole('heading', { level: 2, name: 'Docs' }));
    expect(await preview.getByRole('link', { name: 'Intro' }).getAttribute('href')).toBe(`${site.origin}/docs/intro`);

    const llmsTxt = await rawLlmsTxt();
    expect(llmsTxt).toContain('# Editable Co\n\n> A site that changes between checks.');
    expect(llmsTxt).toContain(`- [Intro](${site.origin}/docs/intro): Start here.`);

    // The hosted URL the page shows serves the same file.
    const hostedPath = await page.getByRole('link', { name: 'Open', exact: true }).getAttribute('href');
    const hosted = await page.request.get(hostedPath!);
    expect(hosted.headers()['content-type']).toContain('text/plain');
    expect((await hosted.text()).trim()).toBe(llmsTxt.trim());

    // The home page now lists the site, linking back to its workspace.
    await page.goto('/');
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
    await visible(page.getByText(/Check now ·/));
    await visible(page.getByText('Version 2', { exact: true }), RUN_TIMEOUT_MS);
    await visible(page.getByText('Published a new version'));
    expect(await rawLlmsTxt()).toContain(`- [Intro](${site.origin}/docs/intro): Begin here instead.`);
  });
});
