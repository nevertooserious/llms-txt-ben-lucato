// Worker process: consumes pipeline runs from the pg-boss queue and runs the monitor
// tick on a schedule. The web app and the worker never call each other; they share
// only Postgres. This file is the composition root: it reads the configuration and
// builds every long-lived dependency once.
import { PgBoss } from 'pg-boss';
import { QUEUE_NAMES } from '@llms-txt/contracts';
import { crawlSite, HeadlessRenderer, resolveSiteRootUrl } from '@llms-txt/crawler';
import { createDatabasePool } from '@llms-txt/db';
import { generateLlmsTxt } from '@llms-txt/generator';
import { createLogger } from '@llms-txt/runtime';
import { createAnthropicLlmClient } from './anthropic-llm-client';
import { readWorkerConfig } from './worker-config';
import { startWorkerJobs } from './worker-jobs';

const config = readWorkerConfig();
const logger = createLogger({ level: config.logLevel, fields: { process: 'worker' } });
const databasePool = createDatabasePool(config.databaseUrl);
const queue = new PgBoss(config.databaseUrl);
queue.on('error', (error) => logger.error('queue error', { error }));
// One renderer for every run, so its concurrency limit holds across the worker. Chromium
// starts on the first render.
const headlessRenderer = new HeadlessRenderer();
const llmClient = config.anthropicApiKey === null ? null : createAnthropicLlmClient(config.anthropicApiKey);
if (llmClient === null) logger.warn('ANTHROPIC_API_KEY is not set; using heuristics instead of LLM assessment');

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
await queue.schedule(QUEUE_NAMES.monitorTick, '*/5 * * * *');

logger.info('worker started', { pipelineRunConcurrency: config.pipelineRunConcurrency });

async function shutDown(signal: string): Promise<void> {
  logger.info('worker stopping', { signal });
  await queue.stop();
  await headlessRenderer.close();
  await databasePool.end();
  process.exit(0);
}
process.once('SIGTERM', () => void shutDown('SIGTERM'));
process.once('SIGINT', () => void shutDown('SIGINT'));
