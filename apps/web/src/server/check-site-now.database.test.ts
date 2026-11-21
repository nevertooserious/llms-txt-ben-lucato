import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool, createWorkspace, findOrCreateSite, type PipelineRunQueue, type WorkspaceAccess } from '@llms-txt/db';
import { checkSiteNow } from './check-site-now';

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

const dependencies = { databasePool, queue, checkNowCooldownSeconds: 300 };

async function newWorkspace(): Promise<WorkspaceAccess> {
  const siteId = await findOrCreateSite(databasePool, `https://${crypto.randomUUID()}.example`);
  const accessTokenHash = crypto.randomUUID();
  const id = await createWorkspace(databasePool, { siteId, accessTokenHash, publicSlug: crypto.randomUUID(), creatorIpHash: null });
  return { id, siteId, accessTokenHash };
}

const finishRun = (pipelineRunId: string, ageSeconds: number) =>
  databasePool.query(
    `update pipeline_runs set status = 'unchanged', created_at = now() - make_interval(secs => $2), finished_at = now()
      where id = $1`,
    [pipelineRunId, ageSeconds],
  );

describe('checkSiteNow', () => {
  it('starts a user_check_now run for a site that has none', async () => {
    const workspace = await newWorkspace();
    const outcome = await checkSiteNow(workspace, dependencies);
    if (outcome.kind !== 'started') throw new Error(`expected a new run, got ${outcome.kind}`);
    const run = await databasePool.query('select triggered_by, requested_by_workspace_id, status from pipeline_runs where id = $1', [
      outcome.pipelineRunId,
    ]);
    expect(run.rows[0]).toEqual({ triggered_by: 'user_check_now', requested_by_workspace_id: workspace.id, status: 'queued' });
  });

  it('joins the run in progress', async () => {
    const workspace = await newWorkspace();
    const first = await checkSiteNow(workspace, dependencies);
    const second = await checkSiteNow(workspace, dependencies);
    expect(second).toEqual({ kind: 'joined', pipelineRunId: (first as { pipelineRunId: string }).pipelineRunId });
  });

  it('refuses within the cooldown of the last run, and starts once it has passed', async () => {
    const workspace = await newWorkspace();
    const first = (await checkSiteNow(workspace, dependencies)) as { pipelineRunId: string };
    await finishRun(first.pipelineRunId, 60);
    const refused = await checkSiteNow(workspace, dependencies);
    expect(refused.kind).toBe('too_soon');
    expect((refused as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(230);
    expect((refused as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(240);

    await finishRun(first.pipelineRunId, 301);
    expect((await checkSiteNow(workspace, dependencies)).kind).toBe('started');
  });
});
