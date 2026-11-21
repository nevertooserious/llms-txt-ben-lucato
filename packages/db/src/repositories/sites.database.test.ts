import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../connection/database-pool';
import { claimDueMonitorChecks, findOrCreateSite } from './sites';
import { withTransaction } from '../connection/transaction';
import { createWorkspace } from './workspaces';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

async function siteWithMonitoring(options: { nextCheck: string; monitoringUntil: string | null }): Promise<string> {
  const siteId = await findOrCreateSite(pool, `https://${randomUUID()}.example`);
  await pool.query(`update sites set next_monitor_check_at = now() + $2::interval where id = $1`, [
    siteId,
    options.nextCheck,
  ]);
  const workspaceId = await createWorkspace(pool, {
    siteId,
    accessTokenHash: randomUUID(),
    publicSlug: randomUUID(),
    creatorIpHash: null,
  });
  if (options.monitoringUntil !== null) {
    await pool.query(`update site_workspaces set monitoring_enabled_until = now() + $2::interval where id = $1`, [
      workspaceId,
      options.monitoringUntil,
    ]);
  }
  return siteId;
}

async function nextCheckIsInFuture(siteId: string): Promise<boolean | null> {
  const result = await pool.query<{ in_future: boolean | null }>(
    'select next_monitor_check_at > now() as in_future from sites where id = $1',
    [siteId],
  );
  return result.rows[0]!.in_future;
}

describe('findOrCreateSite', () => {
  it('returns the same id for the same root URL', async () => {
    const rootUrl = `https://${randomUUID()}.example`;
    expect(await findOrCreateSite(pool, rootUrl)).toBe(await findOrCreateSite(pool, rootUrl));
  });
});

describe('claimDueMonitorChecks', () => {
  it('takes a due, monitored site and moves its next check on', async () => {
    const siteId = await siteWithMonitoring({ nextCheck: '-1 minute', monitoringUntil: '30 days' });
    const claimed = await withTransaction(pool, (transaction) => claimDueMonitorChecks(transaction, 1000));
    expect(claimed).toContain(siteId);
    expect(await nextCheckIsInFuture(siteId)).toBe(true);
  });

  it('unschedules a due site whose workspaces have all let monitoring expire', async () => {
    const siteId = await siteWithMonitoring({ nextCheck: '-1 minute', monitoringUntil: '-1 day' });
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
