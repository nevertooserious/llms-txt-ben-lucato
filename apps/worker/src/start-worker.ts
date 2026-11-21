import { PgBoss } from 'pg-boss';
import { QUEUE_NAMES, type PipelineRunJob } from '@llms-txt/contracts';
import { crawlSite, HeadlessRenderer, type CrawlSiteOptions } from '@llms-txt/crawler';
import { createDatabasePool, createPipelineQueues, type DatabasePool } from '@llms-txt/db';
import { generateLlmsTxt } from '@llms-txt/generator';
import { runMonitorTick } from '@llms-txt/monitor';
import type { Logger } from '@llms-txt/runtime';
import { runPipeline } from './run-pipeline';
import type { WorkerConfig } from './worker-config';

/**
 * Crawl settings only a caller in code can set. Production passes none, so the crawler
 * uses the public-internet-only network policy and its polite default request interval.
 * End-to-end tests pass a policy that opens their fixture sites' loopback ports; there is
 * deliberately no environment variable for this.
 */
export type CrawlOverrides = Partial<Pick<CrawlSiteOptions, 'networkPolicy' | 'resolveHostname' | 'minRequestIntervalMs'>>;

export interface StartWorkerOptions {
  config: WorkerConfig;
  logger: Logger;
  crawlOverrides?: CrawlOverrides;
  /** Shared by every run, so its concurrency limit holds across the worker. Made here when absent. */
  headlessRenderer?: HeadlessRenderer;
  /** Seconds between queue polls when idle. */
  pollingIntervalSeconds?: number;
  /** Whether to schedule and consume the monitor tick. Tests that start runs by hand turn it off. */
  runMonitorTick?: boolean;
}

export interface RunningWorker {
  databasePool: DatabasePool;
  queue: PgBoss;
  /** Stops taking jobs, waits for running ones, and closes the browser and the database pool. */
  stop(): Promise<void>;
}

/**
 * Builds every long-lived dependency once and starts consuming pipeline runs and, unless
 * turned off, the monitor tick. The web app and the worker never call each other; they
 * share only Postgres.
 */
export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const { config, logger } = options;
  const databasePool = createDatabasePool(config.databaseUrl);
  const queue = new PgBoss(config.databaseUrl);
  queue.on('error', (error) => logger.error('queue error', { error }));
  const ownsRenderer = options.headlessRenderer === undefined;
  // Chromium starts on the first render.
  const headlessRenderer =
    options.headlessRenderer ??
    new HeadlessRenderer({
      networkPolicy: options.crawlOverrides?.networkPolicy,
      resolveHostname: options.crawlOverrides?.resolveHostname,
    });

  await queue.start();
  await createPipelineQueues(queue);

  await queue.work<PipelineRunJob>(
    QUEUE_NAMES.pipelineRun,
    {
      localConcurrency: config.pipelineRunConcurrency,
      ...(options.pollingIntervalSeconds !== undefined && { pollingIntervalSeconds: options.pollingIntervalSeconds }),
    },
    async ([job]) => {
      if (job === undefined) return;
      await runPipeline(job.data, {
        databasePool,
        logger: logger.child({ pipelineRunId: job.data.pipelineRunId, siteId: job.data.siteId }),
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        settings: { crawlPageBudget: config.crawlPageBudget, maxFailedFetchShare: config.maxFailedFetchShare },
        crawl: (crawlOptions) => crawlSite({ ...crawlOptions, ...options.crawlOverrides, headlessRenderer }),
        renderLlmsTxt: generateLlmsTxt,
      });
    },
  );

  if (options.runMonitorTick !== false) {
    await queue.schedule(QUEUE_NAMES.monitorTick, '*/5 * * * *');
    await queue.work(QUEUE_NAMES.monitorTick, async () => {
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

  logger.info('worker started', { pipelineRunConcurrency: config.pipelineRunConcurrency });

  return {
    databasePool,
    queue,
    async stop() {
      await queue.stop({ graceful: true });
      if (ownsRenderer) await headlessRenderer.close();
      await databasePool.end();
    },
  };
}
