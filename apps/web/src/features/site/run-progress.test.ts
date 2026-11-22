import { describe, expect, it } from 'vitest';
import type { PipelineRunView } from '@/shared/site-view';
import { pageCountsLabel } from './run-progress';

const run = (fields: Partial<PipelineRunView>): PipelineRunView => ({
  id: '00000000-0000-0000-0000-000000000000',
  status: 'succeeded',
  currentStage: null,
  triggeredBy: 'monitor',
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  pagesDiscoveredCount: 18,
  pagesFetchedCount: 10,
  pagesChangedCount: 0,
  pagesFailedCount: 0,
  ...fields,
});

describe('pageCountsLabel', () => {
  it('counts fetched pages against the page budget, not the pages discovered', () => {
    expect(pageCountsLabel(run({}), 200)).toBe('10 of max 200 fetched');
  });

  it('says how many pages changed and failed on a later run', () => {
    expect(pageCountsLabel(run({ triggeredBy: 'user_check_now', pagesChangedCount: 3, pagesFailedCount: 1 }), 200)).toBe(
      '10 of max 200 fetched, 3 changed, 1 failed',
    );
  });

  it('does not say how many pages changed on the first generation', () => {
    expect(pageCountsLabel(run({ triggeredBy: 'submission', pagesChangedCount: 10, pagesFailedCount: 1 }), 200)).toBe(
      '10 of max 200 fetched, 1 failed',
    );
  });
});
