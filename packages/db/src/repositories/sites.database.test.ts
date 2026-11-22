import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../connection/database-pool';
import { claimDueMonitorChecks, createSite } from './sites';
import { createUserIfAbsent } from './users';
import { withTransaction } from '../connection/transaction';

/** Sites need an owner; these tests are not about who it is. */
const TEST_OWNER = { username: 'test-owner', passwordHash: 'matches no password' };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

async function siteWithNextCheck(nextCheck: string): Promise<string> {
  const siteId = await createSite(pool, {
    ownerUserId: (await createUserIfAbsent(pool, TEST_OWNER)).id,
    rootUrl: `https://${randomUUID()}.example`,
    publicSlug: randomUUID(),
  });
  await pool.query('update sites set next_monitor_check_at = now() + $2::interval where id = $1', [siteId, nextCheck]);
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
    const first = await createSite(pool, {
    ownerUserId: (await createUserIfAbsent(pool, TEST_OWNER)).id,
    rootUrl, publicSlug: randomUUID() });
    const second = await createSite(pool, {
    ownerUserId: (await createUserIfAbsent(pool, TEST_OWNER)).id,
    rootUrl, publicSlug: randomUUID() });
    expect(second).not.toBe(first);
  });
});

describe('claimDueMonitorChecks', () => {
  it('takes a due site and moves its next check on', async () => {
    const siteId = await siteWithNextCheck('-1 minute');
    const claimed = await withTransaction(pool, (transaction) => claimDueMonitorChecks(transaction, 1000));
    expect(claimed).toContain(siteId);
    expect(await nextCheckIsInFuture(siteId)).toBe(true);
  });

  it('leaves a site that is not due', async () => {
    const siteId = await siteWithNextCheck('1 hour');
    const claimed = await withTransaction(pool, (transaction) => claimDueMonitorChecks(transaction, 1000));
    expect(claimed).not.toContain(siteId);
  });
});
