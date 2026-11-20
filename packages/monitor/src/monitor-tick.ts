import { NotImplementedError, type PipelineRunJob } from '@llms-txt/contracts';
import type { DatabasePool } from '@llms-txt/db';

/**
 * Creates a pipeline_runs row for each site whose next_monitor_check_at has passed and
 * enqueues it at a lower priority than user submissions. Returns the number enqueued.
 */
export async function enqueueDueMonitorChecks(
  databasePool: DatabasePool,
  enqueuePipelineRun: (job: PipelineRunJob) => Promise<void>,
): Promise<number> {
  void databasePool;
  void enqueuePipelineRun;
  throw new NotImplementedError('enqueueDueMonitorChecks');
}

/** Marks running pipeline_runs with a stale heartbeat as failed. Returns the count. */
export async function reapStalePipelineRuns(databasePool: DatabasePool): Promise<number> {
  void databasePool;
  throw new NotImplementedError('reapStalePipelineRuns');
}
