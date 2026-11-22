import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../connection/database-pool';
import { publishLlmsTxtVersion } from './llms-txt-versions';
import { scheduleSiteMonitoring } from './monitor-schedule';
import { createSite, deleteSite } from './sites';
import { withTransaction } from '../connection/transaction';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

const DAY_MS = 24 * 3600 * 1000;

const newSite = () =>
  createSite(pool, { rootUrl: `https://${randomUUID()}.example`, publicSlug: randomUUID() });
const schedule = (siteId: string) =>
  withTransaction(pool, (transaction) => scheduleSiteMonitoring(transaction, siteId));
const publish = (siteId: string) =>
  withTransaction(pool, (transaction) =>
    publishLlmsTxtVersion(transaction, {
      siteId,
      pipelineRunId: null,
      createdBy: 'pipeline',
      llmsTxtContent: '# Site',
      llmsTxtContentHash: 'hash',
      listedPageCount: 0,
      pageChanges: { added: [], removed: [], changed: [] },
    }),
  );

describe('scheduleSiteMonitoring', () => {
  it('schedules a site a full interval out', async () => {
    const nextCheckAt = await schedule(await newSite());
    // monitor_check_interval defaults to 7 days.
    expect(nextCheckAt.getTime() - Date.now()).toBeGreaterThan(6.9 * DAY_MS);
    expect(nextCheckAt.getTime() - Date.now()).toBeLessThan(7.1 * DAY_MS);
  });

  it('leaves a check that is already scheduled where it is', async () => {
    const siteId = await newSite();
    await pool.query(`update sites set next_monitor_check_at = now() + interval '1 hour' where id = $1`, [siteId]);
    const first = await schedule(siteId);
    const second = await schedule(siteId);
    expect(second.getTime()).toBe(first.getTime());
    expect(second.getTime() - Date.now()).toBeLessThan(3600 * 1000);
  });

  it('refuses a site that does not exist', async () => {
    await expect(schedule(randomUUID())).rejects.toThrow(/no site/);
  });
});

describe('deleteSite', () => {
  it('deletes the site, and says so only once', async () => {
    const siteId = await newSite();
    await schedule(siteId);
    expect(await deleteSite(pool, siteId)).toBe(true);
    expect((await pool.query('select 1 from sites where id = $1', [siteId])).rowCount).toBe(0);
    expect(await deleteSite(pool, siteId)).toBe(false);
  });

  it('deletes a site that has a published version, with its versions', async () => {
    const siteId = await newSite();
    expect(await publish(siteId)).not.toBeNull();
    expect(await deleteSite(pool, siteId)).toBe(true);
    const versions = await pool.query('select 1 from llms_txt_versions where site_id = $1', [siteId]);
    expect(versions.rowCount).toBe(0);
  });

  it('deletes a site with an active run, and its run', async () => {
    const siteId = await newSite();
    await pool.query(`insert into pipeline_runs (site_id, triggered_by, status) values ($1, 'monitor', 'running')`, [siteId]);
    expect(await deleteSite(pool, siteId)).toBe(true);
    expect((await pool.query('select 1 from pipeline_runs where site_id = $1', [siteId])).rowCount).toBe(0);
  });

  it('publishing to a deleted site does nothing', async () => {
    const siteId = await newSite();
    await deleteSite(pool, siteId);
    expect(await publish(siteId)).toBeNull();
  });
});
