import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDatabasePool, createSite, type PipelineRunQueue } from '@llms-txt/db';
import { runMonitorTick } from './monitor-tick';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);

afterAll(() => databasePool.end());

// Stands in for pg-boss: runs its insert through the transaction it is handed, as pg-boss does.
const fakeQueue = () => {
  const send = vi.fn<PipelineRunQueue['send']>(async (...args: unknown[]) => {
    const options = args[2] as { id: string; db: { executeSql: (text: string) => Promise<unknown> } };
    await options.db.executeSql('select 1');
    return options.id;
  });
  return { send } as unknown as PipelineRunQueue & { send: typeof send };
};

async function dueMonitoredSite(): Promise<string> {
  const siteId = await createSite(databasePool, {
    rootUrl: `https://${randomUUID()}.example`,
    publicSlug: randomUUID(),
  });
  await databasePool.query(`update sites set next_monitor_check_at = now() - interval '1 minute' where id = $1`, [siteId]);
  return siteId;
}

const tick = (queue: PipelineRunQueue) =>
  runMonitorTick({
    databasePool,
    queue,
    thresholds: { heartbeatStaleAfterSeconds: 120, queuedStaleAfterSeconds: 6 * 3600 },
    maxChecksPerTick: 1000,
  });

describe('runMonitorTick', () => {
  it('enqueues a monitor run for a due site, once', async () => {
    const siteId = await dueMonitoredSite();
    const queue = fakeQueue();
    await tick(queue);
    const runs = await databasePool.query<{ triggered_by: string; status: string }>(
      'select triggered_by, status from pipeline_runs where site_id = $1',
      [siteId],
    );
    expect(runs.rows).toEqual([{ triggered_by: 'monitor', status: 'queued' }]);
    // The next check has moved on, so a second tick does not take the site again.
    await tick(queue);
    expect((await databasePool.query('select 1 from pipeline_runs where site_id = $1', [siteId])).rowCount).toBe(1);
  });

  it('keeps nothing when sending the job fails', async () => {
    const siteId = await dueMonitoredSite();
    const queue = fakeQueue();
    queue.send.mockRejectedValue(new Error('queue unavailable'));
    await expect(tick(queue)).rejects.toThrow('queue unavailable');
    expect((await databasePool.query('select 1 from pipeline_runs where site_id = $1', [siteId])).rowCount).toBe(0);
    const site = await databasePool.query<{ is_due: boolean }>(
      'select next_monitor_check_at <= now() as is_due from sites where id = $1',
      [siteId],
    );
    expect(site.rows[0]?.is_due).toBe(true);
  });
});
