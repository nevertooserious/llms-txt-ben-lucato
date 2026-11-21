import type { PgBoss } from 'pg-boss';
import { QUEUE_NAMES, type PipelineRunJob } from '@llms-txt/contracts';
import { createPipelineQueues, type DatabasePool } from '@llms-txt/db';
import { runMonitorTick } from '@llms-txt/monitor';
import type { Logger } from '@llms-txt/runtime';
import type { PipelineStageDependencies } from './pipeline-stages';
import { runPipeline } from './run-pipeline';
import type { WorkerConfig } from './worker-config';

export interface WorkerJobDependencies extends Pick<PipelineStageDependencies, 'crawl' | 'renderLlmsTxt'> {
  queue: PgBoss;
  databasePool: DatabasePool;
  logger: Logger;
  config: WorkerConfig;
  /** How often an idle worker polls for jobs; pg-boss's default when absent. Tests poll faster. */
  pollingIntervalSeconds?: number;
}

/**
 * Creates the queues and starts consuming both job types: pipeline runs, and the
 * monitor tick that reaps stale runs and enqueues due checks. The cron schedule that
 * sends the tick is the caller's, so a test can send ticks itself.
 */
export async function startWorkerJobs(dependencies: WorkerJobDependencies): Promise<void> {
  const { queue, databasePool, logger, config, pollingIntervalSeconds } = dependencies;
  await createPipelineQueues(queue);
  const polling = pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds };

  await queue.work<PipelineRunJob>(
    QUEUE_NAMES.pipelineRun,
    { localConcurrency: config.pipelineRunConcurrency, ...polling },
    async ([job]) => {
      if (job === undefined) return;
      await runPipeline(job.data, {
        databasePool,
        logger: logger.child({ pipelineRunId: job.data.pipelineRunId, siteId: job.data.siteId }),
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        settings: { crawlPageBudget: config.crawlPageBudget, maxFailedFetchShare: config.maxFailedFetchShare },
        crawl: dependencies.crawl,
        renderLlmsTxt: dependencies.renderLlmsTxt,
      });
    },
  );

  await queue.work(QUEUE_NAMES.monitorTick, polling, async () => {
    const outcome = await runMonitorTick({
      databasePool,
      queue,
      thresholds: {
        heartbeatStaleAfterSeconds: config.heartbeatStaleAfterSeconds,
        queuedStaleAfterSeconds: config.queuedStaleAfterSeconds,
      },
      maxChecksPerTick: config.maxMonitorChecksPerTick,
    });
    logger.info('monitor tick', { ...outcome });
  });
}
