import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from '@llms-txt/contracts';
import { crawlSite, resolveSiteRootUrl } from '@llms-txt/crawler';
import { createDatabasePool, type DatabasePool } from '@llms-txt/db';
import { generateLlmsTxt } from '@llms-txt/generator';
import { createLogger } from '@llms-txt/runtime';
import { readWorkerConfig } from '../../apps/worker/src/config/worker-config';
import { startWorkerJobs } from '../../apps/worker/src/jobs/worker-jobs';
import { createStubLlmClient } from '../../apps/worker/src/llm/stub-llm-client';
import { POST as submitSiteRoute } from '../../apps/web/src/app/api/sites/route';
import { POST as checkNowRoute } from '../../apps/web/src/app/api/sites/[publicSlug]/runs/route';
import { GET as runRoute } from '../../apps/web/src/app/api/sites/[publicSlug]/runs/[pipelineRunId]/route';
import { GET as runFileRoute } from '../../apps/web/src/app/api/sites/[publicSlug]/runs/[pipelineRunId]/llms.txt/route';
import { GET as versionFileRoute } from '../../apps/web/src/app/api/sites/[publicSlug]/versions/[versionNumber]/llms.txt/route';
import { DELETE as unpinVersionRoute, PUT as pinVersionRoute } from '../../apps/web/src/app/api/sites/[publicSlug]/published-version/route';
import { DELETE as deleteSiteRoute } from '../../apps/web/src/app/api/sites/[publicSlug]/route';
import { GET as hostedLlmsTxtRoute } from '../../apps/web/src/app/w/[publicSlug]/llms.txt/route';
import { webServices } from '../../apps/web/src/server/composition/web-services';
import { changingSite } from '../fixture-sites/changing-site/routes';
import { startFixtureSite, type FixtureSite } from '../support/fixture-site-server';
import { allowLoopbackPorts } from '../support/local-network-policy';

// The monitor end to end: a site is submitted through the web app's route handlers,
// which turns monitoring on, and scheduled checks and "check now" run through the real
// queue (pg-boss), the worker's job handlers, and the real crawler against a fixture
// site that the test changes between checks. Ticks are sent to the queue by hand
// instead of waiting for the worker's five-minute cron, and a check is made due by
// moving sites.next_monitor_check_at back.
//
// Needs DATABASE_URL pointing at a database with db/schema.sql applied (CI's e2e job
// has one). Skipped locally without it.

const databaseUrl = process.env.DATABASE_URL;
if (process.env.CI && !databaseUrl) throw new Error('DATABASE_URL must be set in CI for the monitor end-to-end test');

const FINISHED_STATUSES = ['succeeded', 'unchanged', 'failed'];

describe.skipIf(!databaseUrl)('monitor, end to end', () => {
  let site: FixtureSite;
  let databasePool: DatabasePool;
  let workerQueue: PgBoss;
  // Set by the submission, used by every later step.
  let siteId: string;
  let publicSlug: string;

  beforeAll(async () => {
    changingSite.reset();
    site = await startFixtureSite('changing-site');
    databasePool = createDatabasePool(databaseUrl!);
    workerQueue = new PgBoss({ connectionString: databaseUrl!, schedule: false });
    await workerQueue.start();
    const networkPolicy = allowLoopbackPorts([site.port]);
    await startWorkerJobs({
      queue: workerQueue,
      databasePool,
      logger: createLogger({ level: 'error' }),
      config: readWorkerConfig({ DATABASE_URL: databaseUrl , LLM_CLIENT: 'stub' }),
      crawl: (options) => crawlSite({ ...options, networkPolicy, minRequestIntervalMs: 20 }),
      resolveRootUrl: (rootUrl) => resolveSiteRootUrl({ rootUrl, networkPolicy, minRequestIntervalMs: 20 }),
      renderLlmsTxt: generateLlmsTxt,
      llmClient: createStubLlmClient(),
      pollingIntervalSeconds: 0.5,
    });
  });

  afterAll(async () => {
    await workerQueue?.stop({ graceful: false });
    if (databaseUrl) {
      const services = webServices();
      await (await services.queue()).stop({ graceful: false });
      await services.databasePool.end();
    }
    await databasePool?.end();
    await site?.close();
    changingSite.reset();
  });

  // --- helpers -------------------------------------------------------------------------

  const slugParams = () => ({ params: Promise.resolve({ publicSlug }) });

  function apiRequest(method: string, body?: unknown): Request {
    return new Request('http://app.test/api', {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function hostedLlmsTxt(): Promise<string> {
    const response = await hostedLlmsTxtRoute(new Request('http://app.test/llms.txt'), slugParams());
    expect(response.status).toBe(200);
    return response.text();
  }

  async function versions() {
    const result = await databasePool.query<{ version_number: number; page_changes: unknown }>(
      `select versions.version_number, versions.page_changes
         from llms_txt_versions versions
         join sites on sites.id = versions.site_id
        where sites.public_slug = $1
        order by versions.version_number`,
      [publicSlug],
    );
    return result.rows;
  }

  async function runIds(): Promise<string[]> {
    const result = await databasePool.query<{ id: string }>('select id from pipeline_runs where site_id = $1', [siteId]);
    return result.rows.map((row) => row.id);
  }

  /** Waits for the site's run that is not in `previousRunIds` to finish, and returns it. */
  async function waitForNewRun(previousRunIds: string[]) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await databasePool.query<{
        id: string;
        triggered_by: string;
        status: string;
        error_message: string | null;
      }>(
        `select id, triggered_by, status, error_message from pipeline_runs
          where site_id = $1 and not (id = any($2::uuid[]))`,
        [siteId, previousRunIds],
      );
      const run = result.rows[0];
      if (run !== undefined && FINISHED_STATUSES.includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('the run did not finish within 30 seconds');
  }

  /** Sends one monitor tick to the queue, as the worker's cron does, and waits for the worker to finish it. */
  async function runMonitorTick(): Promise<void> {
    const jobId = await workerQueue.send(QUEUE_NAMES.monitorTick, {});
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const [job] = await workerQueue.findJobs(QUEUE_NAMES.monitorTick, { id: jobId! });
      if (job?.state === 'completed') return;
      if (job?.state === 'failed') throw new Error(`the monitor tick failed: ${JSON.stringify(job.output)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('the monitor tick did not finish within 30 seconds');
  }

  /** Makes the site's check due, runs a tick, and returns the check's run. */
  async function scheduledCheck() {
    const before = await runIds();
    await databasePool.query(
      `update sites set next_monitor_check_at = now() - interval '1 second' where id = $1`,
      [siteId],
    );
    await runMonitorTick();
    return waitForNewRun(before);
  }

  async function monitorSchedule() {
    const result = await databasePool.query<{ next_check_in_days: number | null; was_just_checked: boolean | null }>(
      `select extract(epoch from next_monitor_check_at - now())::float8 / 86400 as next_check_in_days,
              last_monitor_check_at > now() - interval '1 minute' as was_just_checked
         from sites where id = $1`,
      [siteId],
    );
    return result.rows[0]!;
  }

  // --- the life of a monitored site, in order ------------------------------------------

  it('a submission publishes the first version', async () => {
    const response = await submitSiteRoute(apiRequest('POST', { url: site.origin }));
    expect(response.status).toBe(202);
    const submitted = (await response.json()) as { publicSlug: string; pipelineRunId: string };
    ({ publicSlug } = submitted);
    const sites = await databasePool.query<{ id: string }>('select id from sites where public_slug = $1', [publicSlug]);
    siteId = sites.rows[0]!.id;

    const run = await waitForNewRun([]);
    expect(run).toMatchObject({ id: submitted.pipelineRunId, triggered_by: 'submission', status: 'succeeded' });
    const llmsTxt = await hostedLlmsTxt();
    expect(llmsTxt).toContain('# Acme');
    expect(llmsTxt).toContain(`- [Pricing](${site.origin}/pricing): What Acme costs.`);
    expect(llmsTxt).toContain(`- [Launch post](${site.origin}/blog/launch)`);
  });

  it('a submission schedules the first check a full interval out', async () => {
    expect((await monitorSchedule()).next_check_in_days).toBeCloseTo(7, 1);

    // Not due yet, so a tick leaves the site alone.
    const before = await runIds();
    await runMonitorTick();
    expect(await runIds()).toEqual(before);
  });

  it('a scheduled check of an unchanged site publishes nothing and moves the schedule on', async () => {
    const run = await scheduledCheck();
    expect(run).toMatchObject({ triggered_by: 'monitor', status: 'unchanged' });
    expect(await versions()).toHaveLength(1);
    const schedule = await monitorSchedule();
    expect(schedule.next_check_in_days).toBeCloseTo(7, 1);
    expect(schedule.was_just_checked).toBe(true);
  });

  it('a changed title is published as a new version', async () => {
    changingSite.pages['/pricing']!.title = 'Plans and pricing';
    expect(await scheduledCheck()).toMatchObject({ triggered_by: 'monitor', status: 'succeeded' });
    expect(await hostedLlmsTxt()).toContain(`- [Plans and pricing](${site.origin}/pricing)`);
    expect((await versions()).at(-1)).toEqual({
      version_number: 2,
      page_changes: { added: [], removed: [], changed: [`${site.origin}/pricing`] },
    });
  });

  it('a new page is added', async () => {
    changingSite.pages['/guides/setup'] = { title: 'Setup', description: 'Install Acme.', status: 200, isLinked: true };
    expect(await scheduledCheck()).toMatchObject({ status: 'succeeded' });
    expect(await hostedLlmsTxt()).toContain(`- [Setup](${site.origin}/guides/setup): Install Acme.`);
    expect((await versions()).at(-1)?.page_changes).toEqual({
      added: [`${site.origin}/guides/setup`],
      removed: [],
      changed: [],
    });
  });

  it('a page that answers 404 is removed by that check', async () => {
    changingSite.pages['/blog/launch'] = { ...changingSite.pages['/blog/launch']!, status: 404, isLinked: false };

    expect(await scheduledCheck()).toMatchObject({ status: 'succeeded' });
    expect(await hostedLlmsTxt()).not.toContain(`${site.origin}/blog/launch`);
    expect((await versions()).at(-1)?.page_changes).toEqual({
      added: [],
      removed: [`${site.origin}/blog/launch`],
      changed: [],
    });
  });

  it('"check now" runs a check straight away, then cools down', async () => {
    // The scheduled checks above just ran; move them out of the cooldown.
    await databasePool.query(`update pipeline_runs set created_at = created_at - interval '1 hour' where site_id = $1`, [
      siteId,
    ]);
    changingSite.pages['/docs']!.description = 'Everything about using Acme.';

    const before = await runIds();
    const response = await checkNowRoute(apiRequest('POST'), slugParams());
    expect(response.status).toBe(202);
    const started = (await response.json()) as { pipelineRunId: string; joinedActiveRun: boolean };
    expect(started.joinedActiveRun).toBe(false);
    expect(await waitForNewRun(before)).toMatchObject({
      id: started.pipelineRunId,
      triggered_by: 'user_check_now',
      status: 'succeeded',
    });
    expect(await hostedLlmsTxt()).toContain('Everything about using Acme.');

    const tooSoon = await checkNowRoute(apiRequest('POST'), slugParams());
    expect(tooSoon.status).toBe(429);
    expect(Number(tooSoon.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('a pinned version stays live while checks record newer ones, until it is unpinned', async () => {
    const pin = (body: unknown) => pinVersionRoute(apiRequest('PUT', body), slugParams());
    const versionCount = (await versions()).length;
    const newestBefore = await hostedLlmsTxt();

    expect((await pin({ versionNumber: 'two' })).status).toBe(400);
    expect((await pin({ versionNumber: 2 ** 31 })).status).toBe(400);
    expect((await pin({ versionNumber: 999 })).status).toBe(404);
    expect(await hostedLlmsTxt()).toBe(newestBefore);

    expect((await pin({ versionNumber: 2 })).status).toBe(200);
    const pinned = await hostedLlmsTxt();
    expect(pinned).toContain('[Plans and pricing]');
    expect(pinned).not.toContain('/guides/setup');

    // A change is recorded as a new version, and does not go live.
    changingSite.pages['/docs']!.description = 'Written while pinned.';
    expect(await scheduledCheck()).toMatchObject({ status: 'succeeded' });
    expect(await versions()).toHaveLength(versionCount + 1);
    expect(await hostedLlmsTxt()).toBe(pinned);

    // Nothing changed since that version, so no duplicate is recorded.
    expect(await scheduledCheck()).toMatchObject({ status: 'unchanged' });
    expect(await versions()).toHaveLength(versionCount + 1);
    expect(await hostedLlmsTxt()).toBe(pinned);

    // Unpinning serves the newest version, and later changes go live again.
    expect((await unpinVersionRoute(apiRequest('DELETE'), slugParams())).status).toBe(204);
    expect(await hostedLlmsTxt()).toContain('Written while pinned.');
    changingSite.pages['/docs']!.description = 'Written after unpinning.';
    expect(await scheduledCheck()).toMatchObject({ status: 'succeeded' });
    expect(await hostedLlmsTxt()).toContain('Written after unpinning.');
  });

  it('keeps checking a site long after it was submitted', async () => {
    await databasePool.query(`update sites set created_at = created_at - interval '1 year' where id = $1`, [siteId]);
    expect(await scheduledCheck()).toMatchObject({ triggered_by: 'monitor' });
    expect((await monitorSchedule()).next_check_in_days).toBeCloseTo(7, 1);
  });

  it('reports each run and serves the file it published', async () => {
    const runParams = (pipelineRunId: string) => ({ params: Promise.resolve({ publicSlug, pipelineRunId }) });
    const fileRequest = () => new Request('http://app.test/llms.txt');
    const runs = await databasePool.query<{ id: string; status: string; version_number: number | null }>(
      `select runs.id, runs.status, versions.version_number
         from pipeline_runs runs
         left join llms_txt_versions versions on versions.pipeline_run_id = runs.id
        where runs.site_id = $1
        order by runs.created_at`,
      [siteId],
    );

    const published = runs.rows.find((row) => row.version_number !== null)!;
    const statusResponse = await runRoute(apiRequest('GET'), runParams(published.id));
    expect(statusResponse.status).toBe(200);
    const status = (await statusResponse.json()) as Record<string, unknown>;
    expect(status).toMatchObject({
      id: published.id,
      status: 'succeeded',
      versionNumber: published.version_number,
      llmsTxtUrl: `/api/sites/${encodeURIComponent(publicSlug)}/runs/${published.id}/llms.txt`,
    });
    expect(status.pagesFetchedCount).toBeGreaterThan(0);

    const versionParams = { params: Promise.resolve({ publicSlug, versionNumber: String(published.version_number) }) };
    const versionFile = await versionFileRoute(fileRequest(), versionParams);
    expect(versionFile.status).toBe(200);
    expect(versionFile.headers.get('content-type')).toContain('text/plain');
    const versionText = await versionFile.text();
    expect(versionText).toContain('# Acme');
    const runFile = await runFileRoute(fileRequest(), runParams(published.id));
    expect(await runFile.text()).toBe(versionText);

    // A run that changed nothing has no file of its own.
    const unchanged = runs.rows.find((row) => row.status === 'unchanged')!;
    const noFile = await runFileRoute(fileRequest(), runParams(unchanged.id));
    expect(noFile.status).toBe(404);
    expect(await noFile.json()).toMatchObject({ code: 'run_produced_no_version' });

    // A run that is not this site's is not found, and neither is a malformed id.
    for (const unknownRunId of [crypto.randomUUID(), 'not-a-run']) {
      const notFound = await runRoute(apiRequest('GET'), runParams(unknownRunId));
      expect(notFound.status).toBe(404);
      expect(await notFound.json()).toMatchObject({ code: 'run_not_found' });
    }
    const missingVersion = await versionFileRoute(fileRequest(), {
      params: Promise.resolve({ publicSlug, versionNumber: '999' }),
    });
    expect(await missingVersion.json()).toMatchObject({ code: 'version_not_found' });
  });

  it('a deleted site loses its file and its checks', async () => {
    expect((await hostedLlmsTxtRoute(new Request('http://app.test/llms.txt'), slugParams())).status).toBe(200);

    expect((await deleteSiteRoute(apiRequest('DELETE'), slugParams())).status).toBe(204);
    expect((await hostedLlmsTxtRoute(new Request('http://app.test/llms.txt'), slugParams())).status).toBe(404);
    expect((await deleteSiteRoute(apiRequest('DELETE'), slugParams())).status).toBe(404);
    const sites = await databasePool.query('select 1 from sites where id = $1', [siteId]);
    expect(sites.rowCount).toBe(0);
  });
});
