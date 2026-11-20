import { NotImplementedError, type PipelineRunJob } from '@llms-txt/contracts';
import type { DatabasePool } from '@llms-txt/db';

export interface PipelineDependencies {
  databasePool: DatabasePool;
}

/**
 * One site's run: crawl -> extract -> generate, then publish per workspace.
 *
 * Each stage writes only its own column group in `pages`. The run heartbeats
 * pipeline_runs.last_heartbeat_at while it works and updates the progress counters
 * the frontend polls.
 */
export async function runPipeline(job: PipelineRunJob, dependencies: PipelineDependencies): Promise<void> {
  void job;
  void dependencies;
  throw new NotImplementedError('runPipeline');
}
