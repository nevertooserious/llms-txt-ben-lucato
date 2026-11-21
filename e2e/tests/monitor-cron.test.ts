import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from '@llms-txt/contracts';
import { crawlSite, resolveSiteRootUrl } from '@llms-txt/crawler';
import { createDatabasePool, createSite, type DatabasePool } from '@llms-txt/db';
import { generateLlmsTxt } from '@llms-txt/generator';
import { createLogger } from '@llms-txt/runtime';
import { readWorkerConfig } from '../../apps/worker/src/config/worker-config';
import { MONITOR_TICK_CRON, scheduleMonitorTick, startWorkerJobs } from '../../apps/worker/src/jobs/worker-jobs';
import { changingSite } from '../fixture-sites/changing-site/routes';
import { startFixtureSite, type FixtureSite } from '../support/fixture-site-server';
import { allowLoopbackPorts } from '../support/local-network-policy';
import { createE2eDatabase } from '../support/web-app-stack';

// The real clock: pg-boss's scheduler, not a tick sent by hand, starts a check of a due
// site. The worker registers its five-minute schedule, then the test narrows it to every
// minute so the wait is bounded. A database of its own keeps this scheduler from sending
// ticks to the workers of the other e2e files.
//
// Needs DATABASE_URL pointing at a role that may create databases. Skipped without it.

const databaseUrl = process.env.DATABASE_URL;
if (process.env.CI && !databaseUrl) throw new Error('DATABASE_URL must be set in CI for the monitor cron test');

const CRON_FIRE_TIMEOUT_MS = 150_000;

describe.skipIf(!databaseUrl)('the monitor schedule, on the real clock', () => {
  let site: FixtureSite;
  let databasePool: DatabasePool;
  let workerQueue: PgBoss;
  let dropDatabase: () => Promise<void>;

  beforeAll(async () => {
    changingSite.reset();
    site = await startFixtureSite('changing-site');
    const database = await createE2eDatabase(databaseUrl!);
    dropDatabase = database.dropDatabase;
    databasePool = createDatabasePool(database.databaseUrl);
    workerQueue = new PgBoss({
      connectionString: database.databaseUrl,
      cronMonitorIntervalSeconds: 1,
      cronWorkerIntervalSeconds: 1,
    });
    await workerQueue.start();
    const networkPolicy = allowLoopbackPorts([site.port]);
    await startWorkerJobs({
      queue: workerQueue,
      databasePool,
      logger: createLogger({ level: 'error' }),
      config: readWorkerConfig({ DATABASE_URL: database.databaseUrl }),
      crawl: (options) => crawlSite({ ...options, networkPolicy, minRequestIntervalMs: 20 }),
      resolveRootUrl: (rootUrl) => resolveSiteRootUrl({ rootUrl, networkPolicy, minRequestIntervalMs: 20 }),
      renderLlmsTxt: generateLlmsTxt,
      pollingIntervalSeconds: 0.5,
    });
  }, 30_000);

  afterAll(async () => {
    await workerQueue?.stop({ graceful: false });
    await databasePool?.end();
    await dropDatabase?.();
    await site?.close();
    changingSite.reset();
  });

  it('registers the five-minute schedule', async () => {
    await scheduleMonitorTick(workerQueue);
    const schedules = await workerQueue.getSchedules(QUEUE_NAMES.monitorTick);
    expect(schedules.map((schedule) => schedule.cron)).toEqual([MONITOR_TICK_CRON]);
    expect(MONITOR_TICK_CRON).toBe('*/5 * * * *');
  });

  it('checks a due site with no tick sent by hand', async () => {
    const siteId = await createSite(databasePool, {
      rootUrl: site.origin,
      publicSlug: crypto.randomUUID(),
      creatorIpHash: null,
    });
    await databasePool.query(
      `update sites
          set monitoring_enabled_until = now() + interval '30 days',
              next_monitor_check_at = now() - interval '1 second'
        where id = $1`,
      [siteId],
    );

    await scheduleMonitorTick(workerQueue, '* * * * *');

    const deadline = Date.now() + CRON_FIRE_TIMEOUT_MS - 5_000;
    for (;;) {
      const runs = await databasePool.query<{ triggered_by: string; status: string }>(
        'select triggered_by, status from pipeline_runs where site_id = $1',
        [siteId],
      );
      const run = runs.rows[0];
      if (run !== undefined && ['succeeded', 'unchanged', 'failed'].includes(run.status)) {
        expect(run).toEqual({ triggered_by: 'monitor', status: 'succeeded' });
        break;
      }
      if (Date.now() > deadline) throw new Error('the scheduler did not start a check in time');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const schedule = await databasePool.query<{ is_in_future: boolean }>(
      'select next_monitor_check_at > now() as is_in_future from sites where id = $1',
      [siteId],
    );
    expect(schedule.rows[0]?.is_in_future).toBe(true);
  }, CRON_FIRE_TIMEOUT_MS);
});
