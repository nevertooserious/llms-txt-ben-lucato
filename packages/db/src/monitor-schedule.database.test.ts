import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from './database-pool';
import { disableWorkspaceMonitoring, enableWorkspaceMonitoring } from './monitor-schedule';
import { findOrCreateSite } from './sites';
import { withTransaction } from './transaction';
import { createWorkspace } from './workspaces';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

const DAY_MS = 24 * 3600 * 1000;

async function newSite(): Promise<string> {
  return findOrCreateSite(pool, `https://${randomUUID()}.example`);
}

async function newWorkspace(siteId: string): Promise<string> {
  return createWorkspace(pool, { siteId, accessTokenHash: randomUUID(), publicSlug: randomUUID(), creatorIpHash: null });
}

const enable = (siteId: string, workspaceId: string, durationSeconds = 30 * 86400) =>
  withTransaction(pool, (transaction) => enableWorkspaceMonitoring(transaction, { siteId, workspaceId, durationSeconds }));
const disable = (siteId: string, workspaceId: string) =>
  withTransaction(pool, (transaction) => disableWorkspaceMonitoring(transaction, { siteId, workspaceId }));

describe('enableWorkspaceMonitoring', () => {
  it('turns monitoring on and schedules the site a full interval out', async () => {
    const siteId = await newSite();
    const schedule = await enable(siteId, await newWorkspace(siteId), 30 * 86400);
    expect(schedule.monitoringEnabledUntil!.getTime() - Date.now()).toBeGreaterThan(29 * DAY_MS);
    // monitor_check_interval defaults to 7 days.
    expect(schedule.nextMonitorCheckAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * DAY_MS);
    expect(schedule.nextMonitorCheckAt!.getTime() - Date.now()).toBeLessThan(7.1 * DAY_MS);
  });

  it('leaves a check that is already scheduled where it is, and renews the expiry', async () => {
    const siteId = await newSite();
    const workspaceId = await newWorkspace(siteId);
    await pool.query(`update sites set next_monitor_check_at = now() + interval '1 hour' where id = $1`, [siteId]);
    const first = await enable(siteId, workspaceId, 3600);
    const renewed = await enable(siteId, workspaceId, 2 * 3600);
    expect(renewed.nextMonitorCheckAt!.getTime()).toBe(first.nextMonitorCheckAt!.getTime());
    expect(renewed.nextMonitorCheckAt!.getTime() - Date.now()).toBeLessThan(3600 * 1000);
    expect(renewed.monitoringEnabledUntil!.getTime()).toBeGreaterThan(first.monitoringEnabledUntil!.getTime());
  });

  it('refuses a workspace that belongs to another site', async () => {
    const siteId = await newSite();
    const otherSiteId = await newSite();
    await expect(enable(siteId, await newWorkspace(otherSiteId))).rejects.toThrow(/no workspace/);
  });
});

describe('disableWorkspaceMonitoring', () => {
  it('unschedules the site when no other workspace is monitoring it', async () => {
    const siteId = await newSite();
    const workspaceId = await newWorkspace(siteId);
    await enable(siteId, workspaceId);
    expect(await disable(siteId, workspaceId)).toEqual({ monitoringEnabledUntil: null, nextMonitorCheckAt: null });
  });

  it('keeps the schedule while another workspace of the site is monitoring', async () => {
    const siteId = await newSite();
    const mine = await newWorkspace(siteId);
    const theirs = await newWorkspace(siteId);
    await enable(siteId, mine);
    const { nextMonitorCheckAt } = await enable(siteId, theirs);
    expect((await disable(siteId, mine)).nextMonitorCheckAt).toEqual(nextMonitorCheckAt);
  });
});
