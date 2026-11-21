import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { QUEUE_NAMES, type PipelineRunJob, type PipelineTrigger } from '@llms-txt/contracts';
import type { Transaction } from '../connection/transaction';

// The one place pipeline-run jobs are created, by the web app and the monitor alike.
// A job is sent in the same transaction as its pipeline_runs row, through pg-boss's `db`
// option, so a crash can never leave a queued row without a job: such a row would hold
// the site's one-active-run slot for good.

/** pg-boss runs higher numbers first. Users wait on submissions and "check now". */
const PIPELINE_RUN_PRIORITY: Record<PipelineTrigger, number> = {
  submission: 0,
  user_check_now: 0,
  monitor: -1,
};

/**
 * No queue-level retries. pipeline_runs is the record of a run, and a retried job would
 * find its run already failed by the reaper; a failed run is retried by the next monitor
 * check or by the user. Expiry is well past the longest run (a crawl stops taking pages
 * after 15 minutes) and only cleans up after a worker that died.
 */
export const PIPELINE_RUN_QUEUE_OPTIONS = { retryLimit: 0, expireInSeconds: 45 * 60 } as const;

export type PipelineRunQueue = Pick<PgBoss, 'send'>;

export async function createPipelineQueues(queue: Pick<PgBoss, 'createQueue'>): Promise<void> {
  await queue.createQueue(QUEUE_NAMES.pipelineRun, PIPELINE_RUN_QUEUE_OPTIONS);
  await queue.createQueue(QUEUE_NAMES.monitorTick);
}

export interface StartPipelineRunRequest {
  siteId: string;
  triggeredBy: PipelineTrigger;
  /** Null for monitor runs. */
  requestedByWorkspaceId: string | null;
}

export type StartPipelineRunOutcome =
  | { kind: 'started'; pipelineRunId: string }
  /** The site already has a queued or running run; its id, unless it finished meanwhile. */
  | { kind: 'already_active'; pipelineRunId: string | null };

/**
 * Inserts a queued pipeline_runs row and sends its job, both inside `transaction`. The
 * job's id is the run's id. A site that already has an active run gets no second one.
 */
export async function startPipelineRun(
  transaction: Transaction,
  queue: PipelineRunQueue,
  request: StartPipelineRunRequest,
): Promise<StartPipelineRunOutcome> {
  const pipelineRunId = randomUUID();
  const inserted = await transaction.query(
    `insert into pipeline_runs (id, site_id, requested_by_workspace_id, triggered_by, queue_job_id)
     values ($1, $2, $3, $4, $1)
     on conflict (site_id) where status in ('queued', 'running') do nothing`,
    [pipelineRunId, request.siteId, request.requestedByWorkspaceId, request.triggeredBy],
  );
  if (inserted.rowCount === 0) {
    const active = await transaction.query<{ id: string }>(
      `select id from pipeline_runs where site_id = $1 and status in ('queued', 'running')`,
      [request.siteId],
    );
    return { kind: 'already_active', pipelineRunId: active.rows[0]?.id ?? null };
  }

  const job: PipelineRunJob = { pipelineRunId, siteId: request.siteId };
  await queue.send(QUEUE_NAMES.pipelineRun, job, {
    id: pipelineRunId,
    priority: PIPELINE_RUN_PRIORITY[request.triggeredBy],
    db: { executeSql: (text, values) => transaction.query(text, values) },
  });
  return { kind: 'started', pipelineRunId };
}
