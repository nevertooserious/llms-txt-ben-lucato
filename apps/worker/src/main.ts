// Worker process entry point: reads the configuration, starts the worker (start-worker.ts)
// and stops it cleanly on a signal.
import { createLogger } from '@llms-txt/runtime';
import { startWorker } from './start-worker';
import { readWorkerConfig } from './worker-config';

const config = readWorkerConfig();
const logger = createLogger({ level: config.logLevel, fields: { process: 'worker' } });
const worker = await startWorker({ config, logger });

async function shutDown(signal: string): Promise<void> {
  logger.info('worker stopping', { signal });
  await worker.stop();
  process.exit(0);
}
process.once('SIGTERM', () => void shutDown('SIGTERM'));
process.once('SIGINT', () => void shutDown('SIGINT'));
