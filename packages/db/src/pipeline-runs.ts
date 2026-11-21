import type { Queryable, Transaction } from './transaction';

// pipeline_runs status changes. Each is a conditional update that names the status it
// expects, so the worker, the reaper and a late pg-boss delivery cannot overwrite one
// another: whoever loses the race changes nothing and is told so.
//
//   queued  --claim-->  running  --finish-->  succeeded | unchanged | failed
//   queued | running  --reap-->  failed

export type PipelineRunStage = 'crawl' | 'extract' | 'generate';
export type FinishedPipelineRunStatus = 'succeeded' | 'unchanged' | 'failed';

/**
 * queued -> running. False when the run is no longer queued (already claimed, or reaped),
 * in which case the job carrying it should be dropped.
 */
export async function claimPipelineRun(database: Queryable, pipelineRunId: string): Promise<boolean> {
  const result = await database.query(
    `update pipeline_runs
        set status = 'running', started_at = now(), last_heartbeat_at = now()
      where id = $1 and status = 'queued'`,
    [pipelineRunId],
  );
  return result.rowCount === 1;
}

/** False when the run is no longer running, e.g. the reaper failed it. */
export async function recordPipelineRunHeartbeat(database: Queryable, pipelineRunId: string): Promise<boolean> {
  const result = await database.query(
    `update pipeline_runs set last_heartbeat_at = now() where id = $1 and status = 'running'`,
    [pipelineRunId],
  );
  return result.rowCount === 1;
}

export interface PipelineRunProgress {
  currentStage?: PipelineRunStage;
  pagesDiscoveredCount?: number;
  pagesFetchedCount?: number;
  pagesChangedCount?: number;
  pagesFailedCount?: number;
}

/** Updates the counters the frontend polls; fields left out keep their value. Also a heartbeat. */
export async function recordPipelineRunProgress(
  database: Queryable,
  pipelineRunId: string,
  progress: PipelineRunProgress,
): Promise<boolean> {
  const result = await database.query(
    `update pipeline_runs
        set current_stage = coalesce($2, current_stage),
            pages_discovered_count = coalesce($3, pages_discovered_count),
            pages_fetched_count = coalesce($4, pages_fetched_count),
            pages_changed_count = coalesce($5, pages_changed_count),
            pages_failed_count = coalesce($6, pages_failed_count),
            last_heartbeat_at = now()
      where id = $1 and status = 'running'`,
    [
      pipelineRunId,
      progress.currentStage ?? null,
      progress.pagesDiscoveredCount ?? null,
      progress.pagesFetchedCount ?? null,
      progress.pagesChangedCount ?? null,
      progress.pagesFailedCount ?? null,
    ],
  );
  return result.rowCount === 1;
}

/** running -> a final status. False when the run was no longer running. */
export async function finishPipelineRun(
  database: Queryable,
  pipelineRunId: string,
  outcome: { status: FinishedPipelineRunStatus; errorMessage?: string | null },
): Promise<boolean> {
  const result = await database.query(
    `update pipeline_runs
        set status = $2, error_message = $3, finished_at = now()
      where id = $1 and status = 'running'`,
    [pipelineRunId, outcome.status, outcome.errorMessage ?? null],
  );
  return result.rowCount === 1;
}

/**
 * Locks the run's row if it is still running, for a write that must not land after the
 * run was reaped (publishing a version). Holds until the transaction ends.
 */
export async function lockRunningPipelineRun(transaction: Transaction, pipelineRunId: string): Promise<boolean> {
  const result = await transaction.query(
    `select 1 from pipeline_runs where id = $1 and status = 'running' for update`,
    [pipelineRunId],
  );
  return result.rowCount === 1;
}

export interface StalePipelineRunThresholds {
  /** A running run whose heartbeat is older than this has lost its worker. */
  heartbeatStaleAfterSeconds: number;
  /**
   * A run still queued after this long will never be picked up: its job failed or
   * expired before the worker claimed it. Long, because monitor checks may wait behind
   * user submissions.
   */
  queuedStaleAfterSeconds: number;
}

/** Fails stale running and queued runs, which frees each site's active-run slot. Returns the count. */
export async function reapStalePipelineRuns(
  database: Queryable,
  thresholds: StalePipelineRunThresholds,
): Promise<number> {
  const result = await database.query(
    `update pipeline_runs
        set status = 'failed',
            finished_at = now(),
            error_message = case status
              when 'running' then 'The worker stopped sending heartbeats.'
              else 'The run was never picked up by a worker.'
            end
      where (status = 'running' and last_heartbeat_at < now() - make_interval(secs => $1))
         or (status = 'queued' and created_at < now() - make_interval(secs => $2))`,
    [thresholds.heartbeatStaleAfterSeconds, thresholds.queuedStaleAfterSeconds],
  );
  return result.rowCount ?? 0;
}
