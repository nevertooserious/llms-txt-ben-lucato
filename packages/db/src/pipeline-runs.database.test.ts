import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from '@llms-txt/contracts';
import { createDatabasePool } from './database-pool';
import { createPipelineQueues, startPipelineRun } from './pipeline-run-queue';
import {
  claimPipelineRun,
  finishPipelineRun,
  reapStalePipelineRuns,
  recordPipelineRunHeartbeat,
} from './pipeline-runs';
import { findOrCreateSite } from './sites';
import { withTransaction } from './transaction';

// Runs against a database with db/schema.sql applied (the CI `schema` job), with a real
// pg-boss, so the run row and its job are checked to commit and roll back together.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);
const queue = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });

beforeAll(async () => {
  await queue.start();
  await createPipelineQueues(queue);
});

afterAll(async () => {
  await queue.stop({ graceful: false });
  await pool.end();
});

const newSite = () => findOrCreateSite(pool, `https://${randomUUID()}.example`);
const startSubmission = (siteId: string) =>
  withTransaction(pool, (transaction) =>
    startPipelineRun(transaction, queue, { siteId, triggeredBy: 'submission', requestedByWorkspaceId: null }),
  );

async function runStatus(pipelineRunId: string): Promise<string | undefined> {
  const result = await pool.query<{ status: string }>('select status from pipeline_runs where id = $1', [pipelineRunId]);
  return result.rows[0]?.status;
}

async function jobExists(pipelineRunId: string): Promise<boolean> {
  return (await queue.findJobs(QUEUE_NAMES.pipelineRun, { id: pipelineRunId })).length === 1;
}

describe('startPipelineRun', () => {
  it('inserts a queued run and its job, whose id is the run id', async () => {
    const outcome = await startSubmission(await newSite());
    expect(outcome.kind).toBe('started');
    expect(await runStatus(outcome.pipelineRunId!)).toBe('queued');
    expect(await jobExists(outcome.pipelineRunId!)).toBe(true);
  });

  it('leaves neither the run nor the job behind when the transaction rolls back', async () => {
    const siteId = await newSite();
    let pipelineRunId: string | null = null;
    await expect(
      withTransaction(pool, async (transaction) => {
        const outcome = await startPipelineRun(transaction, queue, {
          siteId,
          triggeredBy: 'submission',
          requestedByWorkspaceId: null,
        });
        pipelineRunId = outcome.pipelineRunId;
        throw new Error('crash after enqueueing');
      }),
    ).rejects.toThrow('crash after enqueueing');
    expect(pipelineRunId).not.toBeNull();
    expect(await runStatus(pipelineRunId!)).toBeUndefined();
    expect(await jobExists(pipelineRunId!)).toBe(false);
  });

  it('starts no second run for a site that has an active one', async () => {
    const siteId = await newSite();
    const first = await startSubmission(siteId);
    const second = await startSubmission(siteId);
    expect(second).toEqual({ kind: 'already_active', pipelineRunId: first.pipelineRunId });
  });
});

describe('status changes', () => {
  it('claims a queued run once', async () => {
    const { pipelineRunId } = await startSubmission(await newSite());
    expect(await claimPipelineRun(pool, pipelineRunId!)).toBe(true);
    expect(await claimPipelineRun(pool, pipelineRunId!)).toBe(false);
    expect(await runStatus(pipelineRunId!)).toBe('running');
  });

  it('finishes only a running run', async () => {
    const { pipelineRunId } = await startSubmission(await newSite());
    expect(await finishPipelineRun(pool, pipelineRunId!, { status: 'succeeded' })).toBe(false);
    await claimPipelineRun(pool, pipelineRunId!);
    expect(await finishPipelineRun(pool, pipelineRunId!, { status: 'succeeded' })).toBe(true);
    expect(await finishPipelineRun(pool, pipelineRunId!, { status: 'failed' })).toBe(false);
    expect(await runStatus(pipelineRunId!)).toBe('succeeded');
  });

  it('frees the site for a new run once its run has finished', async () => {
    const siteId = await newSite();
    const { pipelineRunId } = await startSubmission(siteId);
    await claimPipelineRun(pool, pipelineRunId!);
    await finishPipelineRun(pool, pipelineRunId!, { status: 'unchanged' });
    expect((await startSubmission(siteId)).kind).toBe('started');
  });
});

describe('reapStalePipelineRuns', () => {
  const thresholds = { heartbeatStaleAfterSeconds: 120, queuedStaleAfterSeconds: 6 * 3600 };

  it('fails a running run whose heartbeat is stale, and the worker can no longer finish it', async () => {
    const { pipelineRunId } = await startSubmission(await newSite());
    await claimPipelineRun(pool, pipelineRunId!);
    await pool.query(`update pipeline_runs set last_heartbeat_at = now() - interval '10 minutes' where id = $1`, [
      pipelineRunId,
    ]);
    expect(await reapStalePipelineRuns(pool, thresholds)).toBeGreaterThanOrEqual(1);
    expect(await runStatus(pipelineRunId!)).toBe('failed');
    expect(await recordPipelineRunHeartbeat(pool, pipelineRunId!)).toBe(false);
    expect(await finishPipelineRun(pool, pipelineRunId!, { status: 'succeeded' })).toBe(false);
  });

  it('fails a run that has been queued too long, so its job can no longer claim it', async () => {
    const { pipelineRunId } = await startSubmission(await newSite());
    await pool.query(`update pipeline_runs set created_at = now() - interval '7 hours' where id = $1`, [pipelineRunId]);
    await reapStalePipelineRuns(pool, thresholds);
    expect(await runStatus(pipelineRunId!)).toBe('failed');
    expect(await claimPipelineRun(pool, pipelineRunId!)).toBe(false);
  });

  it('leaves fresh runs alone', async () => {
    const queued = await startSubmission(await newSite());
    const running = await startSubmission(await newSite());
    await claimPipelineRun(pool, running.pipelineRunId!);
    await reapStalePipelineRuns(pool, thresholds);
    expect(await runStatus(queued.pipelineRunId!)).toBe('queued');
    expect(await runStatus(running.pipelineRunId!)).toBe('running');
  });
});
