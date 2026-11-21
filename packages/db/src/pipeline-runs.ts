import type { PipelineTrigger } from '@llms-txt/contracts';
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

export interface LatestPipelineRun {
  id: string;
  isActive: boolean;
  /** Seconds since the run was created. */
  ageSeconds: number;
}

/**
 * The site's most recently created run, or null if it has none. An active (queued or
 * running) run is always the latest, since a site has at most one and no run can be
 * created while it lasts.
 */
export async function loadLatestPipelineRun(database: Queryable, siteId: string): Promise<LatestPipelineRun | null> {
  const result = await database.query<{ id: string; is_active: boolean; age_seconds: number }>(
    `select id,
            status in ('queued', 'running') as is_active,
            extract(epoch from now() - created_at)::float8 as age_seconds
       from pipeline_runs
      where site_id = $1
      order by created_at desc
      limit 1`,
    [siteId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, isActive: row.is_active, ageSeconds: row.age_seconds };
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

export type PipelineRunStatus = 'queued' | 'running' | FinishedPipelineRunStatus;

/** A run as the frontend shows it: where it is in the process. */
export interface PipelineRunSummary {
  id: string;
  status: PipelineRunStatus;
  currentStage: PipelineRunStage | null;
  triggeredBy: PipelineTrigger;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** The site's most recently created run, for the frontend to poll, or null if it has none. */
export async function loadLatestPipelineRunSummary(
  database: Queryable,
  siteId: string,
): Promise<PipelineRunSummary | null> {
  const result = await database.query<{
    id: string;
    status: PipelineRunStatus;
    current_stage: PipelineRunStage | null;
    triggered_by: PipelineTrigger;
    error_message: string | null;
    created_at: Date;
    started_at: Date | null;
    finished_at: Date | null;
  }>(
    `select id, status, current_stage, triggered_by, error_message, created_at, started_at, finished_at
       from pipeline_runs
      where site_id = $1
      order by created_at desc
      limit 1`,
    [siteId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    status: row.status,
    currentStage: row.current_stage,
    triggeredBy: row.triggered_by,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** One run of a site, with what it did and the version it published, if any. */
export interface PipelineRunDetail extends PipelineRunSummary {
  pagesDiscoveredCount: number;
  pagesFetchedCount: number;
  pagesChangedCount: number;
  pagesFailedCount: number;
  /** The version this run published. Null while it is active, and for a run that changed nothing or failed. */
  versionNumber: number | null;
}

/** A run of this site, or null: a run of another site is not found. */
export async function loadPipelineRunDetail(
  database: Queryable,
  siteId: string,
  pipelineRunId: string,
): Promise<PipelineRunDetail | null> {
  const result = await database.query<{
    id: string;
    status: PipelineRunStatus;
    current_stage: PipelineRunStage | null;
    triggered_by: PipelineTrigger;
    error_message: string | null;
    created_at: Date;
    started_at: Date | null;
    finished_at: Date | null;
    pages_discovered_count: number;
    pages_fetched_count: number;
    pages_changed_count: number;
    pages_failed_count: number;
    version_number: number | null;
  }>(
    `select runs.id, runs.status, runs.current_stage, runs.triggered_by, runs.error_message,
            runs.created_at, runs.started_at, runs.finished_at,
            runs.pages_discovered_count, runs.pages_fetched_count,
            runs.pages_changed_count, runs.pages_failed_count,
            versions.version_number
       from pipeline_runs runs
       left join llms_txt_versions versions on versions.pipeline_run_id = runs.id
      where runs.site_id = $1 and runs.id = $2`,
    [siteId, pipelineRunId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    status: row.status,
    currentStage: row.current_stage,
    triggeredBy: row.triggered_by,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    pagesDiscoveredCount: row.pages_discovered_count,
    pagesFetchedCount: row.pages_fetched_count,
    pagesChangedCount: row.pages_changed_count,
    pagesFailedCount: row.pages_failed_count,
    versionNumber: row.version_number,
  };
}
