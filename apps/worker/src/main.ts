// Worker process: consumes pipeline runs from the pg-boss queue and runs the monitor
// tick on a schedule. The web app and the worker never call each other; they share
// only Postgres. This file is the composition root: it reads the configuration and
// builds every long-lived dependency once.
import { PgBoss } from 'pg-boss';
import { QUEUE_NAMES, type PipelineRunJob } from '@llms-txt/contracts';
import { createDatabasePool, createPipelineQueues } from '@llms-txt/db';
import { runMonitorTick } from '@llms-txt/monitor';
import { createLogger } from '@llms-txt/runtime';
import { runPipeline } from './run-pipeline';
import { readWorkerConfig } from './worker-config';

const config = readWorkerConfig();
const logger = createLogger({ level: config.logLevel, fields: { process: 'worker' } });
const databasePool = createDatabasePool(config.databaseUrl);
const queue = new PgBoss(config.databaseUrl);
queue.on('error', (error) => logger.error('queue error', { error }));

await queue.start();
await createPipelineQueues(queue);

await queue.work<PipelineRunJob>(
  QUEUE_NAMES.pipelineRun,
  { localConcurrency: config.pipelineRunConcurrency },
  async ([job]) => {
    if (job === undefined) return;
    await runPipeline(job.data, {
      databasePool,
      logger: logger.child({ pipelineRunId: job.data.pipelineRunId, siteId: job.data.siteId }),
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    });
  },
);

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

logger.info('worker started', { pipelineRunConcurrency: config.pipelineRunConcurrency });

async function shutDown(signal: string): Promise<void> {
  logger.info('worker stopping', { signal });
  await queue.stop();
  await databasePool.end();
  process.exit(0);
}
process.once('SIGTERM', () => void shutDown('SIGTERM'));
process.once('SIGINT', () => void shutDown('SIGINT'));
