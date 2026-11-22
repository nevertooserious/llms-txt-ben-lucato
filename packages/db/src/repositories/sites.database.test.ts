import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../connection/database-pool';
import { isUniqueViolation } from '../connection/database-errors';
import { claimDueMonitorChecks, createSite, loadOwnedSiteSlugByUrl, saveResolvedRootUrl } from './sites';
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
  it('refuses a second site for a root URL its owner already has', async () => {
    const ownerUserId = (await createUserIfAbsent(pool, TEST_OWNER)).id;
    const rootUrl = `https://${randomUUID()}.example`;
    const publicSlug = randomUUID();
    await createSite(pool, { ownerUserId, rootUrl, publicSlug });

    const second = await createSite(pool, { ownerUserId, rootUrl, publicSlug: randomUUID() }).catch((error: unknown) => error);
    expect(isUniqueViolation(second)).toBe(true);
    expect(await loadOwnedSiteSlugByUrl(pool, ownerUserId, rootUrl)).toBe(publicSlug);
  });

  it('lets another user have a site for the same root URL', async () => {
    const rootUrl = `https://${randomUUID()}.example`;
    const otherOwner = await createUserIfAbsent(pool, { ...TEST_OWNER, username: `other-${randomUUID()}` });
    await createSite(pool, { ownerUserId: (await createUserIfAbsent(pool, TEST_OWNER)).id, rootUrl, publicSlug: randomUUID() });
    const otherSlug = randomUUID();
    await createSite(pool, { ownerUserId: otherOwner.id, rootUrl, publicSlug: otherSlug });
    expect(await loadOwnedSiteSlugByUrl(pool, otherOwner.id, rootUrl)).toBe(otherSlug);
  });
});

describe('saveResolvedRootUrl', () => {
  it('still finds the site by the URL it was submitted as', async () => {
    const ownerUserId = (await createUserIfAbsent(pool, TEST_OWNER)).id;
    const host = `${randomUUID()}.example`;
    const publicSlug = randomUUID();
    const siteId = await createSite(pool, { ownerUserId, rootUrl: `https://${host}`, publicSlug });

    expect(await saveResolvedRootUrl(pool, siteId, `https://www.${host}`)).toBe(true);
    expect(await loadOwnedSiteSlugByUrl(pool, ownerUserId, `https://${host}`)).toBe(publicSlug);
    expect(await loadOwnedSiteSlugByUrl(pool, ownerUserId, `https://www.${host}`)).toBe(publicSlug);
  });

  it('saves nothing when the owner already has a site at the resolved root', async () => {
    const ownerUserId = (await createUserIfAbsent(pool, TEST_OWNER)).id;
    const existingRootUrl = `https://www.${randomUUID()}.example`;
    await createSite(pool, { ownerUserId, rootUrl: existingRootUrl, publicSlug: randomUUID() });
    const rootUrl = `https://${randomUUID()}.example`;
    const siteId = await createSite(pool, { ownerUserId, rootUrl, publicSlug: randomUUID() });

    expect(await saveResolvedRootUrl(pool, siteId, existingRootUrl)).toBe(false);
    const stored = await pool.query<{ root_url: string }>('select root_url from sites where id = $1', [siteId]);
    expect(stored.rows[0]?.root_url).toBe(rootUrl);
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
