import {
  claimDueMonitorChecks,
  reapStalePipelineRuns,
  startPipelineRun,
  withTransaction,
  type DatabasePool,
  type PipelineRunQueue,
  type StalePipelineRunThresholds,
} from '@llms-txt/db';

export interface MonitorTickDependencies {
  databasePool: DatabasePool;
  queue: PipelineRunQueue;
  thresholds: StalePipelineRunThresholds;
  /** Most sites to enqueue in one tick; the rest wait for the next. */
  maxChecksPerTick: number;
}

export interface MonitorTickOutcome {
  reapedRunCount: number;
  enqueuedCheckCount: number;
}

/**
 * Every few minutes: fail runs that lost their worker or were never picked up, then
 * enqueue a check for each site that is due. Claiming the sites, inserting their runs
 * and sending their jobs is one transaction, so a crash leaves either all of it or none.
 */
export async function runMonitorTick(dependencies: MonitorTickDependencies): Promise<MonitorTickOutcome> {
  const { databasePool, queue } = dependencies;
  const reapedRunCount = await reapStalePipelineRuns(databasePool, dependencies.thresholds);
  const enqueuedCheckCount = await withTransaction(databasePool, async (transaction) => {
    const siteIds = await claimDueMonitorChecks(transaction, dependencies.maxChecksPerTick);
    let started = 0;
    for (const siteId of siteIds) {
      // A site whose last run is still going keeps it; its next check is already moved on.
      const outcome = await startPipelineRun(transaction, queue, {
        siteId,
        triggeredBy: 'monitor',
      });
      if (outcome.kind === 'started') started += 1;
    }
    return started;
  });
  return { reapedRunCount, enqueuedCheckCount };
}
