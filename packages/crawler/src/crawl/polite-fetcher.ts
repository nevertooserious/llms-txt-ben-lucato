import type { FetchOutcome, FetchRequest, HttpFetcher } from '../network/http-fetcher';

/** The next request could only be made after the crawl's time limit. */
export class CrawlDeadlineReached extends Error {}

export interface PoliteFetcherOptions {
  fetcher: HttpFetcher;
  /** Least time between two requests to the site. robots.txt Crawl-delay and Retry-After can raise it. */
  minRequestIntervalMs: number;
  /** When the crawl's time limit ends, as a timestamp. */
  deadline: number;
  /** Longest wait honoured for a Retry-After before giving up on that URL. */
  maxRetryAfterMs: number;
}

/**
 * Paces every request of a crawl, plain or rendered: one at a time, no closer together
 * than the request interval, and none that would start after the time limit.
 */
export class PoliteFetcher {
  /** No request starts after this. Moved only to give the last few small requests of a crawl a little longer. */
  deadline: number;
  private requestIntervalMs: number;
  private lastRequestAt = 0;

  constructor(private readonly options: PoliteFetcherOptions) {
    this.deadline = options.deadline;
    this.requestIntervalMs = options.minRequestIntervalMs;
  }

  /** Slows the rest of the crawl down to one request per `intervalMs`, if that is slower. */
  raiseRequestInterval(intervalMs: number): void {
    this.requestIntervalMs = Math.max(this.requestIntervalMs, intervalMs);
  }

  /**
   * A fetch that waits its turn, and retries once when the server asks it to come back
   * later: a 429, or a 503 with Retry-After (RFC 9110, sections 10.2.3 and 15.6.4).
   */
  async fetch(fetchRequest: FetchRequest): Promise<FetchOutcome> {
    await this.waitForRequestSlot();
    const outcome = await this.options.fetcher.fetch(fetchRequest);
    if (outcome.kind !== 'response') return outcome;
    const asksToRetry =
      outcome.httpStatusCode === 429 || (outcome.httpStatusCode === 503 && outcome.headers['retry-after'] !== undefined);
    if (!asksToRetry) return outcome;

    const retryAfterMs = parseRetryAfter(outcome.headers['retry-after']);
    if (retryAfterMs === null || retryAfterMs > this.options.maxRetryAfterMs) return outcome;
    if (Date.now() + retryAfterMs >= this.deadline) throw new CrawlDeadlineReached();
    // Slow down for the rest of the crawl too.
    this.raiseRequestInterval(Math.min(retryAfterMs, 10_000));
    await sleep(retryAfterMs);
    this.lastRequestAt = Date.now();
    return this.options.fetcher.fetch(fetchRequest);
  }

  async waitForRequestSlot(): Promise<void> {
    const waitMs = this.lastRequestAt + this.requestIntervalMs - Date.now();
    // Crawl-delay is honoured as given, so a slot past the time limit ends the crawl.
    if (waitMs > 0 && Date.now() + waitMs >= this.deadline) throw new CrawlDeadlineReached();
    if (waitMs > 0) await sleep(waitMs);
    this.lastRequestAt = Date.now();
  }

  async close(): Promise<void> {
    await this.options.fetcher.close();
  }
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. Null if absent or unreadable. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
