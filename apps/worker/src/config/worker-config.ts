import { ConfigurationError, logLevel, optionalString, positiveInteger, requiredString, type Environment, type LogLevel } from '@llms-txt/runtime';

/** Everything the worker reads from its environment, checked once at startup. */
export interface WorkerConfig {
  databaseUrl: string;
  logLevel: LogLevel;
  /** Sites crawled at once (docs/design/README.md, section 4). */
  pipelineRunConcurrency: number;
  /** How often a running run writes pipeline_runs.last_heartbeat_at. */
  heartbeatIntervalMs: number;
  /** A running run with an older heartbeat is failed by the reaper. */
  heartbeatStaleAfterSeconds: number;
  /** A run still queued after this long is failed by the reaper. */
  queuedStaleAfterSeconds: number;
  /** Most monitor checks enqueued per tick. */
  maxMonitorChecksPerTick: number;
  /** Most pages one run fetches. A starting value; see docs/design/README.md, section 10. */
  crawlPageBudget: number;
  /** Above this share of failed fetches a run fails and publishes nothing. A starting value. */
  maxFailedFetchShare: number;
  llmClient: LlmClientConfig;
}

/** The real model, or a stub for local development and tests, which must be asked for. */
export type LlmClientConfig = { kind: 'anthropic'; apiKey: string } | { kind: 'stub' };

export function readWorkerConfig(environment: Environment = process.env): WorkerConfig {
  return {
    databaseUrl: requiredString(environment, 'DATABASE_URL'),
    logLevel: logLevel(environment, 'LOG_LEVEL', 'info'),
    pipelineRunConcurrency: positiveInteger(environment, 'PIPELINE_RUN_CONCURRENCY', 10),
    heartbeatIntervalMs: 5_000,
    heartbeatStaleAfterSeconds: 120,
    queuedStaleAfterSeconds: 6 * 3600,
    maxMonitorChecksPerTick: 100,
    crawlPageBudget: positiveInteger(environment, 'CRAWL_PAGE_BUDGET', 200),
    maxFailedFetchShare: 0.5,
    llmClient: llmClientConfig(environment),
  };
}

function llmClientConfig(environment: Environment): LlmClientConfig {
  const kind = optionalString(environment, 'LLM_CLIENT') ?? 'anthropic';
  if (kind === 'stub') return { kind };
  if (kind !== 'anthropic') throw new ConfigurationError(`LLM_CLIENT must be one of anthropic, stub, got "${kind}"`);
  const apiKey = optionalString(environment, 'ANTHROPIC_API_KEY');
  if (apiKey === null) throw new ConfigurationError('ANTHROPIC_API_KEY must be set, or LLM_CLIENT=stub for local development');
  return { kind, apiKey };
}
