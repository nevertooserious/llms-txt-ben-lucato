import { describe, expect, it } from 'vitest';
import { ConfigurationError, logLevel, positiveInteger, requiredString } from './environment';
import { createLogger } from './logger';

describe('createLogger', () => {
  const capture = (level: 'info' | 'debug' = 'info') => {
    const lines: string[] = [];
    const logger = createLogger({
      level,
      fields: { process: 'worker' },
      writeLine: (line) => lines.push(line),
      now: () => new Date('2026-11-21T00:00:00Z'),
    });
    return { logger, entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
  };

  it('writes one JSON object per line with bound and call fields', () => {
    const { logger, entries } = capture();
    logger.child({ pipelineRunId: 'run-1' }).info('crawl finished', { pagesFetchedCount: 3 });
    expect(entries()).toEqual([
      {
        time: '2026-11-21T00:00:00.000Z',
        level: 'info',
        message: 'crawl finished',
        process: 'worker',
        pipelineRunId: 'run-1',
        pagesFetchedCount: 3,
      },
    ]);
  });

  it('drops lines below its level', () => {
    const { logger, entries } = capture('info');
    logger.debug('noisy');
    expect(entries()).toEqual([]);
  });

  it('serialises errors with their message and stack', () => {
    const { logger, entries } = capture();
    logger.error('run failed', { error: new Error('boom') });
    expect(entries()[0]?.error).toMatchObject({ name: 'Error', message: 'boom' });
  });
});

describe('environment readers', () => {
  it('reads required values and rejects missing ones by name', () => {
    expect(requiredString({ DATABASE_URL: 'postgres://x' }, 'DATABASE_URL')).toBe('postgres://x');
    expect(() => requiredString({ DATABASE_URL: ' ' }, 'DATABASE_URL')).toThrow(/DATABASE_URL must be set/);
  });

  it('uses the default for an unset integer and rejects a malformed one', () => {
    expect(positiveInteger({}, 'PIPELINE_RUN_CONCURRENCY', 10)).toBe(10);
    expect(positiveInteger({ PIPELINE_RUN_CONCURRENCY: '4' }, 'PIPELINE_RUN_CONCURRENCY', 10)).toBe(4);
    expect(() => positiveInteger({ PIPELINE_RUN_CONCURRENCY: '0' }, 'PIPELINE_RUN_CONCURRENCY', 10)).toThrow(
      ConfigurationError,
    );
  });

  it('accepts only known log levels', () => {
    expect(logLevel({ LOG_LEVEL: 'debug' }, 'LOG_LEVEL', 'info')).toBe('debug');
    expect(() => logLevel({ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL', 'info')).toThrow(/LOG_LEVEL must be one of/);
  });
});
