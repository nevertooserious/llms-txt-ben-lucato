import { describe, expect, it } from 'vitest';
import type { CrawlFailure } from '@llms-txt/contracts';
import { evaluateSafetyGate } from './safety-gate';

const failures = (count: number): CrawlFailure[] =>
  Array.from({ length: count }, (_, index) => ({
    url: `https://example.com/${index}`,
    reason: 'server_error',
    httpStatusCode: 503,
    message: 'HTTP 503',
  }));

describe('evaluateSafetyGate', () => {
  it('passes a run whose failed share is at or under the limit', () => {
    expect(
      evaluateSafetyGate({ stopReason: 'frontier_exhausted', pagesFetchedCount: 5, pagesWithContentCount: 5, failedFetches: failures(5) }, 0.5),
    ).toEqual({ passed: true, failedFetchShare: 0.5 });
  });

  it('fails a run whose failed share is over the limit', () => {
    const verdict = evaluateSafetyGate(
      { stopReason: 'frontier_exhausted', pagesFetchedCount: 4, pagesWithContentCount: 4, failedFetches: failures(6) },
      0.5,
    );
    expect(verdict).toMatchObject({ passed: false, failedFetchShare: 0.6, reason: '60% of fetches failed; nothing was published.' });
  });

  it('fails a run that fetched nothing, or could not read robots.txt', () => {
    expect(evaluateSafetyGate({ stopReason: 'frontier_exhausted', pagesFetchedCount: 0, pagesWithContentCount: 0, failedFetches: [] }, 0.5).passed).toBe(false);
    expect(
      evaluateSafetyGate({ stopReason: 'robots_txt_unreachable', pagesFetchedCount: 0, pagesWithContentCount: 0, failedFetches: failures(1) }, 0.5),
    ).toMatchObject({ passed: false, reason: expect.stringContaining('robots.txt') });
  });

  it('says so when robots.txt rules out the homepage', () => {
    expect(
      evaluateSafetyGate({ stopReason: 'homepage_disallowed_by_robots', pagesFetchedCount: 0, pagesWithContentCount: 0, failedFetches: [] }, 0.5),
    ).toMatchObject({ passed: false, reason: expect.stringContaining('robots.txt does not allow the homepage') });
  });

  it('fails a run where every page answered without content, such as a site-wide 404', () => {
    expect(
      evaluateSafetyGate({ stopReason: 'frontier_exhausted', pagesFetchedCount: 3, pagesWithContentCount: 0, failedFetches: [] }, 0.5),
    ).toMatchObject({ passed: false, reason: 'No page of the site returned any content.' });
  });
});
