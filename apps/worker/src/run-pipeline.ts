import type { PipelineRunJob } from '@llms-txt/contracts';
import { claimPipelineRun, finishPipelineRun, recordPipelineRunHeartbeat } from '@llms-txt/db';
import { PipelineRunFailure, runPipelineStages, type PipelineStageDependencies } from './pipeline-stages';

/** The stage dependencies, with a logger that already carries the run's and the site's ids. */
export interface PipelineDependencies extends PipelineStageDependencies {
  heartbeatIntervalMs: number;
}

/**
 * One site's run: crawl -> extract -> generate, then publish per workspace.
 *
 * The run's lifecycle is guarded: the job only proceeds if it claims a queued run, and
 * the final status is written only if the run is still running, so a run the reaper
 * already failed is left failed. Errors end the run as failed and are not rethrown,
 * because pipeline-run jobs are not retried (see PIPELINE_RUN_QUEUE_OPTIONS).
 */
export async function runPipeline(job: PipelineRunJob, dependencies: PipelineDependencies): Promise<void> {
  const { databasePool, logger } = dependencies;
  if (!(await claimPipelineRun(databasePool, job.pipelineRunId))) {
    logger.warn('run is no longer queued; dropping its job');
    return;
  }
  logger.info('run started');

  const heartbeat = setInterval(() => {
    recordPipelineRunHeartbeat(databasePool, job.pipelineRunId).then(
      (isRunning) => !isRunning && logger.warn('run was failed by the reaper while still working'),
      (error: unknown) => logger.warn('heartbeat failed', { error }),
    );
  }, dependencies.heartbeatIntervalMs);

  try {
    const status = await runPipelineStages(job, dependencies);
    const finished = await finishPipelineRun(databasePool, job.pipelineRunId, { status });
    if (finished) logger.info('run finished', { status });
    else logger.warn('run finished after the reaper failed it; its result was not recorded', { status });
  } catch (error) {
    // A PipelineRunFailure is an expected outcome (the site was unreachable, say); anything else is a bug.
    if (error instanceof PipelineRunFailure) logger.warn('run failed', { reason: error.message });
    else logger.error('run failed', { error });
    await finishPipelineRun(databasePool, job.pipelineRunId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch((finishError: unknown) => logger.error('could not record the failure', { error: finishError }));
  } finally {
    clearInterval(heartbeat);
  }
}
