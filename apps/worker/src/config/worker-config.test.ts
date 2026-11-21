import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '@llms-txt/runtime';
import { readWorkerConfig } from './worker-config';

const DATABASE_URL = 'postgres://localhost/llms_txt';

describe('readWorkerConfig', () => {
  it('uses the defaults, and no LLM, when only the database is set', () => {
    expect(readWorkerConfig({ DATABASE_URL })).toMatchObject({
      databaseUrl: DATABASE_URL,
      logLevel: 'info',
      pipelineRunConcurrency: 10,
      crawlPageBudget: 200,
      anthropicApiKey: null,
    });
  });

  it('reads the optional variables, and treats a blank API key as none', () => {
    const environment = { DATABASE_URL, PIPELINE_RUN_CONCURRENCY: '3', CRAWL_PAGE_BUDGET: '50' };
    expect(readWorkerConfig({ ...environment, ANTHROPIC_API_KEY: ' key ' })).toMatchObject({
      pipelineRunConcurrency: 3,
      crawlPageBudget: 50,
      anthropicApiKey: 'key',
    });
    expect(readWorkerConfig({ ...environment, ANTHROPIC_API_KEY: '  ' }).anthropicApiKey).toBeNull();
  });

  it.each([{}, { DATABASE_URL, CRAWL_PAGE_BUDGET: '0' }, { DATABASE_URL, PIPELINE_RUN_CONCURRENCY: 'ten' }])(
    'stops on a missing or malformed variable: %o',
    (environment) => {
      expect(() => readWorkerConfig(environment)).toThrow(ConfigurationError);
    },
  );
});
