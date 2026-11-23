import type { RawPage } from '@llms-txt/contracts';
import type { CrawledPageWrite, StoredPage } from '@llms-txt/db';

// What one crawled page does to its stored row, including a page
// that has gone missing or come back. Pure: the worker loads the stored row, calls this, and saves
// the result. Pages the crawl did not reach, or could not fetch, never come through
// here, so they are never changed, let alone removed.

export type PageReconciliation =
  /** 2xx: save, then extract. */
  | { kind: 'fetched'; write: CrawledPageWrite }
  /** 304 to a conditional GET: the stored extraction still holds. */
  | { kind: 'not_modified'; write: CrawledPageWrite }
  /**
   * 404 or 410 for a stored page. Saved only once the run passes the safety gate, so a
   * run that fails changes nothing that could remove a page.
   */
  | { kind: 'not_found'; write: CrawledPageWrite; isNewlyRemoved: boolean }
  /** Any other status for a stored page: recorded, but the page is neither restored nor removed. */
  | { kind: 'other_status'; write: CrawledPageWrite }
  /** A new URL that did not answer 2xx: not worth a row. */
  | { kind: 'ignored' };

export function reconcilePage(stored: StoredPage | undefined, page: RawPage, now: Date): PageReconciliation {
  const status = page.httpStatusCode;
  const fromThisFetch = {
    normalisedUrl: page.normalisedUrl,
    fetchUrl: page.fetchUrl,
    fetchMethod: page.fetchMethod,
    crawlDepth: page.crawlSignals.crawlDepth,
    discoveredVia: page.crawlSignals.discoveredVia,
    sitemapLastModifiedAt: sitemapDate(page.sitemapLastModified),
    // Null on a 304 or an error, which keeps the stored links.
    outboundLinkUrls: page.outboundLinkUrls,
  };

  if (status >= 200 && status < 300) {
    return {
      kind: 'fetched',
      write: {
        ...fromThisFetch,
        httpStatusCode: status,
        httpEtag: page.headers.etag ?? null,
        httpLastModified: page.headers['last-modified'] ?? null,
        markdownVariantUrl: page.markdownVariantUrl,
        hasNoindexDirective: page.crawlSignals.hasNoindexDirective,
        removedAt: null,
      },
    };
  }
  if (stored === undefined) return { kind: 'ignored' };

  const keptFromStore = {
    httpEtag: stored.httpEtag,
    httpLastModified: stored.httpLastModified,
    markdownVariantUrl: stored.markdownVariantUrl,
    hasNoindexDirective: stored.hasNoindexDirective,
  };

  if (status === 304) {
    return {
      kind: 'not_modified',
      write: {
        ...fromThisFetch,
        ...keptFromStore,
        // The page is as it was, status included; a server may send fresh validators.
        httpStatusCode: stored.httpStatusCode ?? 200,
        httpEtag: page.headers.etag ?? stored.httpEtag,
        httpLastModified: page.headers['last-modified'] ?? stored.httpLastModified,
        removedAt: null,
      },
    };
  }

  if (status === 404 || status === 410) {
    return {
      kind: 'not_found',
      isNewlyRemoved: stored.removedAt === null,
      write: {
        ...fromThisFetch,
        ...keptFromStore,
        httpStatusCode: status,
        // Ask in full next time, so the next answer is a real one.
        httpEtag: null,
        httpLastModified: null,
        removedAt: stored.removedAt ?? now.toISOString(),
      },
    };
  }

  return {
    kind: 'other_status',
    write: {
      ...fromThisFetch,
      ...keptFromStore,
      httpStatusCode: status,
      removedAt: stored.removedAt,
    },
  };
}

/**
 * A sitemap <lastmod> as ISO 8601, or null when absent or unreadable. A year outside
 * 1 to 9999 is unreadable too: JavaScript reads "202401" as the year 202401 and writes
 * it as "+202401-...", which Postgres rejects, and saving the page would fail the run.
 */
export function sitemapDate(lastModified: string | null): string | null {
  if (lastModified === null) return null;
  const time = Date.parse(lastModified);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  return year >= 1 && year <= 9999 ? date.toISOString() : null;
}
