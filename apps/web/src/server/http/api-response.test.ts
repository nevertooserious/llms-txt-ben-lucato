import { describe, expect, it } from 'vitest';
import { apiError, isPipelineRunId, llmsTxtFileResponse } from './api-response';

const file = { versionNumber: 3, llmsTxtContent: '# Site\n' };

describe('apiError', () => {
  it('carries a message, a stable code and the status', async () => {
    const response = apiError(404, 'site_not_found', 'There is no site here.');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'There is no site here.', code: 'site_not_found' });
  });
});

describe('llmsTxtFileResponse', () => {
  it('serves the file as plain text', async () => {
    const response = llmsTxtFileResponse(file);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-llms-txt-version')).toBe('3');
    expect(await response.text()).toBe('# Site\n');
  });
});

describe('isPipelineRunId', () => {
  it('accepts only a uuid', () => {
    expect(isPipelineRunId('3fdd2011-c5ca-4b50-8d73-0616bfd37f1a')).toBe(true);
    expect(isPipelineRunId('not-a-run')).toBe(false);
    expect(isPipelineRunId("3fdd2011-c5ca-4b50-8d73-0616bfd37f1a' or 1=1")).toBe(false);
  });
});
