import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../connection/database-pool';
import { publishLlmsTxtVersion } from './llms-txt-versions';
import { enableWorkspaceMonitoring } from './monitor-schedule';
import { findOrCreateSite } from './sites';
import { withTransaction } from '../connection/transaction';
import { createWorkspace, deleteWorkspace } from './workspaces';

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
const remove = (workspaceId: string) => withTransaction(pool, (transaction) => deleteWorkspace(transaction, workspaceId));
const siteRow = async (siteId: string) =>
  (await pool.query<{ next_monitor_check_at: Date | null }>('select next_monitor_check_at from sites where id = $1', [siteId]))
    .rows[0];

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

describe('deleteWorkspace', () => {
  it('deletes the site with its last workspace', async () => {
    const siteId = await newSite();
    const workspaceId = await newWorkspace(siteId);
    await enable(siteId, workspaceId);
    expect(await remove(workspaceId)).toBe(true);
    expect(await siteRow(siteId)).toBeUndefined();
    expect(await remove(workspaceId)).toBe(false);
  });

  it('keeps the site and its schedule while another workspace is monitoring', async () => {
    const siteId = await newSite();
    const mine = await newWorkspace(siteId);
    const theirs = await newWorkspace(siteId);
    await enable(siteId, mine);
    const { nextMonitorCheckAt } = await enable(siteId, theirs);
    await remove(mine);
    expect((await siteRow(siteId))?.next_monitor_check_at).toEqual(nextMonitorCheckAt);
    const remaining = await pool.query('select id from site_workspaces where site_id = $1', [siteId]);
    expect(remaining.rows).toEqual([{ id: theirs }]);
  });

  it('unschedules the site when the remaining workspaces have lapsed', async () => {
    const siteId = await newSite();
    const mine = await newWorkspace(siteId);
    await newWorkspace(siteId);
    await enable(siteId, mine);
    await remove(mine);
    expect((await siteRow(siteId))?.next_monitor_check_at).toBeNull();
  });

  it('keeps an emptied site row while a run is active, unscheduled', async () => {
    const siteId = await newSite();
    const workspaceId = await newWorkspace(siteId);
    await enable(siteId, workspaceId);
    await pool.query(`insert into pipeline_runs (site_id, triggered_by, status) values ($1, 'monitor', 'running')`, [siteId]);
    await remove(workspaceId);
    expect(await siteRow(siteId)).toEqual({ next_monitor_check_at: null });
  });

  it('deletes a workspace that has a published version', async () => {
    const siteId = await newSite();
    const workspaceId = await newWorkspace(siteId);
    const version = await withTransaction(pool, (transaction) =>
      publishLlmsTxtVersion(transaction, {
        workspaceId,
        pipelineRunId: null,
        createdBy: 'pipeline',
        llmsTxtContent: '# Site',
        llmsTxtContentHash: 'hash',
        listedPageCount: 0,
        pageChanges: { added: [], removed: [], changed: [] },
      }),
    );
    expect(version).not.toBeNull();
    expect(await remove(workspaceId)).toBe(true);
    const versions = await pool.query('select 1 from llms_txt_versions where workspace_id = $1', [workspaceId]);
    expect(versions.rowCount).toBe(0);
  });

  it('publishing to a deleted workspace does nothing', async () => {
    const siteId = await newSite();
    const workspaceId = await newWorkspace(siteId);
    await remove(workspaceId);
    const version = await withTransaction(pool, (transaction) =>
      publishLlmsTxtVersion(transaction, {
        workspaceId,
        pipelineRunId: null,
        createdBy: 'pipeline',
        llmsTxtContent: '# Site',
        llmsTxtContentHash: 'hash',
        listedPageCount: 0,
        pageChanges: { added: [], removed: [], changed: [] },
      }),
    );
    expect(version).toBeNull();
  });
});
