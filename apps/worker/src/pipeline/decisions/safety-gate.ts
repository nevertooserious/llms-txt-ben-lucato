import type { CrawlResult } from '@llms-txt/contracts';

// The safety gate (docs/design/diagrams/monitor-check.svg): a run whose fetches mostly failed
// says more about the site's health, or about our access to it, than about its content,
// so it publishes nothing and records no removals.

export type SafetyGateVerdict =
  | { passed: true; failedFetchShare: number }
  | { passed: false; failedFetchShare: number; reason: string };

export function evaluateSafetyGate(
  crawl: Pick<CrawlResult, 'stopReason' | 'pagesFetchedCount' | 'pagesWithContentCount' | 'failedFetches'>,
  maxFailedFetchShare: number,
): SafetyGateVerdict {
  const attempts = crawl.pagesFetchedCount + crawl.failedFetches.length;
  const failedFetchShare = attempts === 0 ? 0 : crawl.failedFetches.length / attempts;

  if (crawl.stopReason === 'robots_txt_unreachable') {
    return { passed: false, failedFetchShare, reason: 'robots.txt could not be fetched, so the site was not crawled.' };
  }
  if (crawl.stopReason === 'homepage_disallowed_by_robots') {
    return { passed: false, failedFetchShare, reason: 'robots.txt does not allow the homepage to be fetched, so the site was not crawled.' };
  }
  if (crawl.pagesFetchedCount === 0) {
    return { passed: false, failedFetchShare, reason: 'No page of the site could be fetched.' };
  }
  // Every page answered 404 or 410: a broken deploy looks like this, and must not remove the whole site.
  if (crawl.pagesWithContentCount === 0) {
    return { passed: false, failedFetchShare, reason: 'No page of the site returned any content.' };
  }
  if (failedFetchShare > maxFailedFetchShare) {
    const percent = Math.round(failedFetchShare * 100);
    return { passed: false, failedFetchShare, reason: `${percent}% of fetches failed; nothing was published.` };
  }
  return { passed: true, failedFetchShare };
}
