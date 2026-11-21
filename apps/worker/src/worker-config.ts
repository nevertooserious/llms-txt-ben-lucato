import { logLevel, positiveInteger, requiredString, type Environment, type LogLevel } from '@llms-txt/runtime';

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
}

export function readWorkerConfig(environment: Environment = process.env): WorkerConfig {
  return {
    databaseUrl: requiredString(environment, 'DATABASE_URL'),
    logLevel: logLevel(environment, 'LOG_LEVEL', 'info'),
    pipelineRunConcurrency: positiveInteger(environment, 'PIPELINE_RUN_CONCURRENCY', 10),
    heartbeatIntervalMs: 5_000,
    heartbeatStaleAfterSeconds: 120,
    queuedStaleAfterSeconds: 6 * 3600,
    maxMonitorChecksPerTick: 100,
  };
}
