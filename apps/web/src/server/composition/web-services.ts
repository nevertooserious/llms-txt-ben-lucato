import { PgBoss } from 'pg-boss';
import { createDatabasePool, createPipelineQueues, type DatabasePool } from '@llms-txt/db';
import { createLogger, type Logger } from '@llms-txt/runtime';
import { ensureConfiguredUser } from '../users/authentication';
import { readBasicAuthCredentials, readWebConfig, type WebConfig } from './web-config';

// The web app's long-lived dependencies, built once per server process. Kept on
// globalThis so `next dev` reloading modules does not open a new pool each time.

export interface WebServices {
  config: WebConfig;
  logger: Logger;
  databasePool: DatabasePool;
  /** Started on first use. */
  queue(): Promise<PgBoss>;
  /** Resolves once the user for the configured login exists; done once per process. */
  configuredUserIsReady(): Promise<void>;
}

const globalScope = globalThis as typeof globalThis & { llmsTxtWebServices?: WebServices };

export function webServices(): WebServices {
  globalScope.llmsTxtWebServices ??= buildWebServices();
  return globalScope.llmsTxtWebServices;
}

function buildWebServices(): WebServices {
  const config = readWebConfig();
  const logger = createLogger({ level: config.logLevel, fields: { process: 'web' } });
  let startedQueue: Promise<PgBoss> | null = null;

  const queue = (): Promise<PgBoss> => {
    startedQueue ??= startQueue(config.databaseUrl, logger).catch((error: unknown) => {
      startedQueue = null; // try again on the next request
      throw error;
    });
    return startedQueue;
  };

  const databasePool = createDatabasePool(config.databaseUrl);
  let configuredUser: Promise<void> | null = null;
  const configuredUserIsReady = (): Promise<void> => {
    configuredUser ??= ensureConfiguredUser(databasePool, readBasicAuthCredentials()).then(
      () => undefined,
      (error: unknown) => {
        configuredUser = null; // try again on the next request
        throw error;
      },
    );
    return configuredUser;
  };

  return { config, logger, databasePool, queue, configuredUserIsReady };
}

/** The web app only sends jobs; the worker runs maintenance and the cron schedule. */
async function startQueue(databaseUrl: string, logger: Logger): Promise<PgBoss> {
  const queue = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
  queue.on('error', (error) => logger.error('queue error', { error }));
  await queue.start();
  await createPipelineQueues(queue);
  return queue;
}
