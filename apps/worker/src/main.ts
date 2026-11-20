// Worker process: consumes pipeline runs from the pg-boss queue and runs the monitor
// tick on a schedule. The web app and the worker never call each other; they share
// only Postgres.
import { PgBoss } from 'pg-boss';
import { QUEUE_NAMES, type PipelineRunJob } from '@llms-txt/contracts';
import { createDatabasePool } from '@llms-txt/db';
import { enqueueDueMonitorChecks, reapStalePipelineRuns } from '@llms-txt/monitor';
import { runPipeline } from './run-pipeline';

/** Ten sites run in parallel (docs/design/README.md, section 4). */
const PIPELINE_RUN_CONCURRENCY = 10;
/** Monitor checks queue behind user submissions and "check now". */
const MONITOR_CHECK_PRIORITY = -1;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const databasePool = createDatabasePool(databaseUrl);
const queue = new PgBoss(databaseUrl);
queue.on('error', (error) => console.error('[queue]', error));

await queue.start();
await queue.createQueue(QUEUE_NAMES.pipelineRun);
await queue.createQueue(QUEUE_NAMES.monitorTick);

await queue.work<PipelineRunJob>(
  QUEUE_NAMES.pipelineRun,
  { localConcurrency: PIPELINE_RUN_CONCURRENCY },
  async ([job]) => {
    if (job) await runPipeline(job.data, { databasePool });
  },
);

await queue.schedule(QUEUE_NAMES.monitorTick, '*/5 * * * *');
await queue.work(QUEUE_NAMES.monitorTick, async () => {
  await reapStalePipelineRuns(databasePool);
  await enqueueDueMonitorChecks(databasePool, async (job) => {
    await queue.send(QUEUE_NAMES.pipelineRun, job, { priority: MONITOR_CHECK_PRIORITY });
  });
});

console.log('[worker] started');

async function shutDown(): Promise<void> {
  await queue.stop();
  await databasePool.end();
  process.exit(0);
}
process.once('SIGTERM', () => void shutDown());
process.once('SIGINT', () => void shutDown());
