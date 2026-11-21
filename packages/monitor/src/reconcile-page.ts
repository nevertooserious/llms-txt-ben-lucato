import type { RawPage } from '@llms-txt/contracts';
import type { CrawledPageWrite, StoredPage } from '@llms-txt/db';

// What one crawled page does to its stored row (docs/design/README.md, section 5,
// "Pages that go missing"). Pure: the worker loads the stored row, calls this, and saves
// the result. Pages the crawl did not reach, or could not fetch, never come through
// here, so they are never changed, let alone removed.

/** Consecutive 404 or 410 responses that remove a page from the file. */
export const NOT_FOUND_RESPONSES_BEFORE_REMOVAL = 2;

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
  /** Any other status for a stored page: recorded, but the page is neither reset nor counted toward removal. */
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
        consecutiveNotFoundCount: 0,
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
        consecutiveNotFoundCount: 0,
        removedAt: null,
      },
    };
  }

  if (status === 404 || status === 410) {
    const consecutiveNotFoundCount = stored.consecutiveNotFoundCount + 1;
    const removedAt =
      stored.removedAt ?? (consecutiveNotFoundCount >= NOT_FOUND_RESPONSES_BEFORE_REMOVAL ? now.toISOString() : null);
    return {
      kind: 'not_found',
      isNewlyRemoved: stored.removedAt === null && removedAt !== null,
      write: {
        ...fromThisFetch,
        ...keptFromStore,
        httpStatusCode: status,
        // Ask in full next time, so the next answer is a real one.
        httpEtag: null,
        httpLastModified: null,
        consecutiveNotFoundCount,
        removedAt,
      },
    };
  }

  return {
    kind: 'other_status',
    write: {
      ...fromThisFetch,
      ...keptFromStore,
      httpStatusCode: status,
      consecutiveNotFoundCount: stored.consecutiveNotFoundCount,
      removedAt: stored.removedAt,
    },
  };
}

/** A sitemap <lastmod> as ISO 8601, or null when absent or unreadable. */
export function sitemapDate(lastModified: string | null): string | null {
  if (lastModified === null) return null;
  const time = Date.parse(lastModified);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
