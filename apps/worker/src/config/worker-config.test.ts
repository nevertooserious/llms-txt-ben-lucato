import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '@llms-txt/runtime';
import { readWorkerConfig } from './worker-config';

const DATABASE_URL = 'postgres://localhost/llms_txt';

describe('readWorkerConfig', () => {
  it('uses the defaults when only the required variables are set', () => {
    expect(readWorkerConfig({ DATABASE_URL, ANTHROPIC_API_KEY: ' key ' })).toMatchObject({
      databaseUrl: DATABASE_URL,
      logLevel: 'info',
      pipelineRunConcurrency: 10,
      crawlPageBudget: 200,
      llmClient: { kind: 'anthropic', apiKey: 'key' },
    });
  });

  it('reads the optional variables', () => {
    const environment = { DATABASE_URL, LLM_CLIENT: 'stub', PIPELINE_RUN_CONCURRENCY: '3', CRAWL_PAGE_BUDGET: '50' };
    expect(readWorkerConfig(environment)).toMatchObject({ pipelineRunConcurrency: 3, crawlPageBudget: 50 });
  });

  it('uses the stub only when asked, even with an API key', () => {
    expect(readWorkerConfig({ DATABASE_URL, LLM_CLIENT: 'stub', ANTHROPIC_API_KEY: 'key' }).llmClient).toEqual({ kind: 'stub' });
  });

  it.each([
    {},
    { DATABASE_URL },
    { DATABASE_URL, ANTHROPIC_API_KEY: '  ' },
    { DATABASE_URL, LLM_CLIENT: 'other', ANTHROPIC_API_KEY: 'key' },
    { DATABASE_URL, LLM_CLIENT: 'stub', CRAWL_PAGE_BUDGET: '0' },
    { DATABASE_URL, LLM_CLIENT: 'stub', PIPELINE_RUN_CONCURRENCY: 'ten' },
  ])(
    'stops on a missing or malformed variable: %o',
    (environment) => {
      expect(() => readWorkerConfig(environment)).toThrow(ConfigurationError);
    },
  );
});
