import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool, type PipelineRunQueue } from '@llms-txt/db';
import { submitSite } from './submit-site';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);

afterAll(() => databasePool.end());

// Stands in for pg-boss: runs its insert through the transaction it is handed, as pg-boss does.
const queue = {
  send: async (_name: string, _data: object, options: { id: string; db: { executeSql: (text: string) => Promise<unknown> } }) => {
    await options.db.executeSql('select 1');
    return options.id;
  },
} as unknown as PipelineRunQueue;

const uniqueHost = () => `${crypto.randomUUID()}.example`;

describe('submitSite', () => {
  it('creates a site with monitoring on and a queued run', async () => {
    const outcome = await submitSite(
      { submittedUrl: `${uniqueHost()}/docs/`, clientIp: crypto.randomUUID() },
      { databasePool, queue, submissionsPerIpPerHour: 10 },
    );
    if (outcome.kind !== 'submitted') throw new Error(`expected a submission, got ${outcome.kind}`);
    const stored = await databasePool.query<{ root_url: string; is_monitored: boolean; status: string }>(
      `select sites.root_url, sites.monitoring_enabled_until > now() as is_monitored, runs.status
         from sites
         join pipeline_runs runs on runs.site_id = sites.id and runs.id = $2
        where sites.public_slug = $1`,
      [outcome.publicSlug, outcome.pipelineRunId],
    );
    expect(stored.rows[0]?.root_url).toMatch(/^https:\/\/.*\.example\/docs$/);
    expect(stored.rows[0]?.is_monitored).toBe(true);
    expect(stored.rows[0]?.status).toBe('queued');
  });

  it('gives a second submission of the same URL its own site and its own run', async () => {
    const host = uniqueHost();
    const dependencies = { databasePool, queue, submissionsPerIpPerHour: 10 };
    const first = await submitSite({ submittedUrl: host, clientIp: null }, dependencies);
    const second = await submitSite({ submittedUrl: `https://${host}/`, clientIp: null }, dependencies);
    if (first.kind !== 'submitted' || second.kind !== 'submitted') throw new Error('expected two submissions');
    expect(second.publicSlug).not.toBe(first.publicSlug);
    expect(second.pipelineRunId).not.toBe(first.pipelineRunId);
  });

  it('refuses an IP over its hourly limit', async () => {
    const clientIp = crypto.randomUUID();
    const dependencies = { databasePool, queue, submissionsPerIpPerHour: 1 };
    expect((await submitSite({ submittedUrl: uniqueHost(), clientIp }, dependencies)).kind).toBe('submitted');
    expect((await submitSite({ submittedUrl: uniqueHost(), clientIp }, dependencies)).kind).toBe('rate_limited');
  });

  it('rejects a URL that is not a web address', async () => {
    const outcome = await submitSite(
      { submittedUrl: 'ftp://example.com', clientIp: null },
      { databasePool, queue, submissionsPerIpPerHour: 10 },
    );
    expect(outcome).toEqual({ kind: 'invalid_url' });
  });
});
