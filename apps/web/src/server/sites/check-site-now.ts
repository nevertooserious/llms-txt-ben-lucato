import {
  loadLatestPipelineRun,
  scheduleSiteMonitoring,
  startPipelineRun,
  withTransaction,
  type DatabasePool,
  type PipelineRunQueue,
} from '@llms-txt/db';

export interface CheckSiteNowDependencies {
  databasePool: DatabasePool;
  queue: PipelineRunQueue;
  /** Least time between the start of a site's last run and a check asked for by hand. */
  checkNowCooldownSeconds: number;
}

export type CheckSiteNowOutcome =
  /** A new run, or the site's run already in progress, which the caller joins. */
  | { kind: 'started' | 'joined'; pipelineRunId: string }
  /** The site was checked too recently; the caller may ask again after this long. */
  | { kind: 'too_soon'; retryAfterSeconds: number };

/**
 * "Check now": runs the same pipeline as a scheduled monitor check, ahead of scheduled
 * checks in the queue. A run already in progress for the site is joined. Otherwise a
 * site is checked at most once per cooldown, counted from its last run of any kind, so
 * no one can keep a site under constant crawling.
 */
export async function checkSiteNow(
  siteId: string,
  dependencies: CheckSiteNowDependencies,
): Promise<CheckSiteNowOutcome> {
  return withTransaction(dependencies.databasePool, async (transaction) => {
    await scheduleSiteMonitoring(transaction, siteId);
    const latest = await loadLatestPipelineRun(transaction, siteId);
    if (latest?.isActive) return { kind: 'joined', pipelineRunId: latest.id };
    if (latest !== null && latest.ageSeconds < dependencies.checkNowCooldownSeconds) {
      return { kind: 'too_soon', retryAfterSeconds: Math.ceil(dependencies.checkNowCooldownSeconds - latest.ageSeconds) };
    }
    const outcome = await startPipelineRun(transaction, dependencies.queue, { siteId, triggeredBy: 'user_check_now' });
    if (outcome.kind === 'started') return { kind: 'started', pipelineRunId: outcome.pipelineRunId };
    // Another request started a run between the read above and the insert.
    if (outcome.pipelineRunId !== null) return { kind: 'joined', pipelineRunId: outcome.pipelineRunId };
    return { kind: 'too_soon', retryAfterSeconds: dependencies.checkNowCooldownSeconds };
  });
}
