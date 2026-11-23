import type { CrawlFailure, CrawlFailureReason } from '@llms-txt/contracts';

/** The fetches of a crawl that failed, which the safety gate weighs against those that did not. */
export class CrawlFailureLog {
  readonly failures: CrawlFailure[] = [];

  record(url: string, reason: CrawlFailureReason, message: string, httpStatusCode: number | null = null): void {
    this.failures.push({ url, reason, httpStatusCode, message });
  }

  /** Records a 5xx, 429, 401, 403 or 451 as a failed fetch. Returns whether it was one. */
  recordErrorStatus(url: string, httpStatusCode: number): boolean {
    if (!isErrorStatus(httpStatusCode)) return false;
    const reason = httpStatusCode === 429 ? 'rate_limited' : httpStatusCode >= 500 ? 'server_error' : 'blocked';
    this.record(url, reason, `HTTP ${httpStatusCode}`, httpStatusCode);
    return true;
  }
}

/** A response that says the site is struggling or refusing us, not that the page is gone. */
export function isErrorStatus(httpStatusCode: number): boolean {
  return httpStatusCode >= 500 || [401, 403, 429, 451].includes(httpStatusCode);
}
