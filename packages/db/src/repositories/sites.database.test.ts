import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../connection/database-pool';
import { claimDueMonitorChecks, createSite } from './sites';
import { withTransaction } from '../connection/transaction';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

async function siteWithMonitoring(options: { nextCheck: string; monitoringUntil: string | null }): Promise<string> {
  const siteId = await createSite(pool, {
    rootUrl: `https://${randomUUID()}.example`,
    publicSlug: randomUUID(),
  });
  await pool.query(
    `update sites
        set next_monitor_check_at = now() + $2::interval,
            monitoring_enabled_until = now() + $3::interval
      where id = $1`,
    [siteId, options.nextCheck, options.monitoringUntil],
  );
  return siteId;
}

async function nextCheckIsInFuture(siteId: string): Promise<boolean | null> {
  const result = await pool.query<{ in_future: boolean | null }>(
    'select next_monitor_check_at > now() as in_future from sites where id = $1',
    [siteId],
  );
  return result.rows[0]!.in_future;
}

describe('createSite', () => {
  it('makes an independent site for each submission of the same root URL', async () => {
    const rootUrl = `https://${randomUUID()}.example`;
    const first = await createSite(pool, { rootUrl, publicSlug: randomUUID() });
    const second = await createSite(pool, { rootUrl, publicSlug: randomUUID() });
    expect(second).not.toBe(first);
  });
});

describe('claimDueMonitorChecks', () => {
  it('takes a due, monitored site and moves its next check on', async () => {
    const siteId = await siteWithMonitoring({ nextCheck: '-1 minute', monitoringUntil: '30 days' });
    const claimed = await withTransaction(pool, (transaction) => claimDueMonitorChecks(transaction, 1000));
    expect(claimed).toContain(siteId);
    expect(await nextCheckIsInFuture(siteId)).toBe(true);
  });

  it('unschedules a due site whose monitoring has expired', async () => {
    const siteId = await siteWithMonitoring({ nextCheck: '-1 minute', monitoringUntil: '-1 day' });
    const claimed = await withTransaction(pool, (transaction) => claimDueMonitorChecks(transaction, 1000));
    expect(claimed).not.toContain(siteId);
    expect(await nextCheckIsInFuture(siteId)).toBeNull();
  });

  it('unschedules a due site that never had monitoring', async () => {
    const siteId = await siteWithMonitoring({ nextCheck: '-1 minute', monitoringUntil: null });
    const claimed = await withTransaction(pool, (transaction) => claimDueMonitorChecks(transaction, 1000));
    expect(claimed).not.toContain(siteId);
    expect(await nextCheckIsInFuture(siteId)).toBeNull();
  });

  it('leaves a site that is not due', async () => {
    const siteId = await siteWithMonitoring({ nextCheck: '1 hour', monitoringUntil: '30 days' });
    const claimed = await withTransaction(pool, (transaction) => claimDueMonitorChecks(transaction, 1000));
    expect(claimed).not.toContain(siteId);
  });
});
