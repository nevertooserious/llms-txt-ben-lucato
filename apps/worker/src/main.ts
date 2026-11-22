// Worker process: consumes pipeline runs from the pg-boss queue and runs the monitor
// tick on a schedule. The web app and the worker never call each other; they share
// only Postgres. This file is the composition root: it reads the configuration and
// builds every long-lived dependency once.
import { PgBoss } from 'pg-boss';
import { crawlSite, HeadlessRenderer, resolveSiteRootUrl } from '@llms-txt/crawler';
import { createDatabasePool } from '@llms-txt/db';
import { generateLlmsTxt } from '@llms-txt/generator';
import { createLogger } from '@llms-txt/runtime';
import { createAnthropicLlmClient } from './llm/anthropic-llm-client';
import { createStubLlmClient } from './llm/stub-llm-client';
import { readWorkerConfig } from './config/worker-config';
import { scheduleMonitorTick, startWorkerJobs } from './jobs/worker-jobs';

const config = readWorkerConfig();
const logger = createLogger({ level: config.logLevel, fields: { process: 'worker' } });
const databasePool = createDatabasePool(config.databaseUrl);
const queue = new PgBoss(config.databaseUrl);
queue.on('error', (error) => logger.error('queue error', { error }));
// One renderer for every run, so its concurrency limit holds across the worker. Chromium
// starts on the first render.
const headlessRenderer = new HeadlessRenderer();
const llmClient = config.llmClient.kind === 'stub' ? createStubLlmClient() : createAnthropicLlmClient(config.llmClient.apiKey);
if (config.llmClient.kind === 'stub') logger.warn('LLM_CLIENT=stub: files are built without a model; not for production');

await queue.start();
await startWorkerJobs({
  queue,
  databasePool,
  logger,
  config,
  crawl: (options) => crawlSite({ ...options, headlessRenderer }),
  resolveRootUrl: (rootUrl) => resolveSiteRootUrl({ rootUrl }),
  renderLlmsTxt: generateLlmsTxt,
  llmClient,
});
// The monitor tick: every five minutes, reap stale runs and enqueue due checks.
await scheduleMonitorTick(queue);

logger.info('worker started', { pipelineRunConcurrency: config.pipelineRunConcurrency });

// How long a stopping worker lets its runs finish. A deploy stops the old worker while
// runs are under way, and a run that is cut off fails as "stopped sending heartbeats".
// The host must wait at least this long before it kills the process: on Railway that is
// RAILWAY_DEPLOYMENT_DRAINING_SECONDS on the worker service, which is 0 if unset.
const RUN_DRAIN_TIMEOUT_MILLISECONDS = 10 * 60_000;

async function shutDown(signal: string): Promise<void> {
  logger.info('worker stopping', { signal });
  // Takes no new jobs, and returns once the running ones end or the time is up.
  await queue.stop({ timeout: RUN_DRAIN_TIMEOUT_MILLISECONDS });
  logger.info('worker stopped');
  await headlessRenderer.close();
  await databasePool.end();
  process.exit(0);
}
process.once('SIGTERM', () => void shutDown('SIGTERM'));
process.once('SIGINT', () => void shutDown('SIGINT'));
