import { describe, expect, it } from 'vitest';
import { runStatusLabel } from './site-view';

describe('runStatusLabel', () => {
  it('names what a running run is doing', () => {
    expect(runStatusLabel({ status: 'running', currentStage: null })).toBe('Crawling');
    expect(runStatusLabel({ status: 'running', currentStage: 'crawl' })).toBe('Crawling');
    expect(runStatusLabel({ status: 'running', currentStage: 'extract' })).toBe('Extracting');
    expect(runStatusLabel({ status: 'running', currentStage: 'generate' })).toBe('Generating');
  });

  it('names how a finished run ended, whatever stage it stopped in', () => {
    expect(runStatusLabel({ status: 'queued', currentStage: null })).toBe('Queued');
    expect(runStatusLabel({ status: 'succeeded', currentStage: 'generate' })).toBe('Generated');
    expect(runStatusLabel({ status: 'unchanged', currentStage: 'generate' })).toBe('Generated, no changes');
    expect(runStatusLabel({ status: 'failed', currentStage: 'crawl' })).toBe('Failed');
  });
});
