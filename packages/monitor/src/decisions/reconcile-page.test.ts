import { describe, expect, it } from 'vitest';
import type { RawPage } from '@llms-txt/contracts';
import type { StoredPage } from '@llms-txt/db';
import { reconcilePage, sitemapDate } from './reconcile-page';

const now = new Date('2026-11-21T12:00:00Z');
const url = 'https://example.com/docs';

const rawPage = (httpStatusCode: number, fields: Partial<RawPage> = {}): RawPage => ({
  normalisedUrl: url,
  fetchUrl: `${url}/`,
  finalUrl: `${url}/`,
  httpStatusCode,
  headers: {},
  html: '',
  fetchMethod: 'plain_http',
  crawlSignals: { crawlDepth: 1, discoveredVia: 'navigation', hasNoindexDirective: false },
  markdownVariantUrl: null,
  sitemapLastModified: null,
  ...fields,
});

const storedPage = (fields: Partial<StoredPage> = {}): StoredPage => ({
  normalisedUrl: url,
  fetchUrl: `${url}/`,
  httpStatusCode: 200,
  httpEtag: '"v1"',
  httpLastModified: null,
  fetchMethod: 'plain_http',
  crawlDepth: 1,
  discoveredVia: 'navigation',
  sitemapLastModifiedAt: null,
  markdownVariantUrl: `${url}.md`,
  hasNoindexDirective: false,
  consecutiveNotFoundCount: 0,
  removedAt: null,
  contentDigest: 'digest',
  listingFieldsHash: 'hash',
  ...fields,
});

describe('reconcilePage', () => {
  it('saves a 2xx page from this fetch and resets its removal state', () => {
    const outcome = reconcilePage(
      storedPage({ consecutiveNotFoundCount: 1, removedAt: '2026-11-01T00:00:00.000Z' }),
      rawPage(200, { headers: { etag: '"v2"' }, sitemapLastModified: '2026-10-01' }),
      now,
    );
    expect(outcome.kind).toBe('fetched');
    if (outcome.kind !== 'fetched') return;
    expect(outcome.write).toMatchObject({
      httpStatusCode: 200,
      httpEtag: '"v2"',
      sitemapLastModifiedAt: '2026-10-01T00:00:00.000Z',
      markdownVariantUrl: null,
      consecutiveNotFoundCount: 0,
      removedAt: null,
    });
  });

  it('keeps the stored status and what a 304 cannot tell', () => {
    const outcome = reconcilePage(storedPage({ consecutiveNotFoundCount: 1 }), rawPage(304), now);
    expect(outcome.kind).toBe('not_modified');
    if (outcome.kind !== 'not_modified') return;
    expect(outcome.write).toMatchObject({
      httpStatusCode: 200,
      httpEtag: '"v1"',
      markdownVariantUrl: `${url}.md`,
      consecutiveNotFoundCount: 0,
      removedAt: null,
    });
  });

  it('counts a first 404 and keeps the page listed', () => {
    const outcome = reconcilePage(storedPage(), rawPage(404), now);
    expect(outcome).toMatchObject({
      kind: 'not_found',
      isNewlyRemoved: false,
      write: { httpStatusCode: 404, consecutiveNotFoundCount: 1, removedAt: null, httpEtag: null },
    });
  });

  it('removes the page on a second 404 or 410 in a row', () => {
    const outcome = reconcilePage(storedPage({ consecutiveNotFoundCount: 1 }), rawPage(410), now);
    expect(outcome).toMatchObject({
      kind: 'not_found',
      isNewlyRemoved: true,
      write: { consecutiveNotFoundCount: 2, removedAt: now.toISOString() },
    });
  });

  it('keeps the original removal time on later 404s', () => {
    const removedAt = '2026-11-01T00:00:00.000Z';
    const outcome = reconcilePage(storedPage({ consecutiveNotFoundCount: 2, removedAt }), rawPage(404), now);
    expect(outcome).toMatchObject({ kind: 'not_found', isNewlyRemoved: false, write: { removedAt } });
  });

  it('records another status without counting it toward removal', () => {
    const outcome = reconcilePage(storedPage({ consecutiveNotFoundCount: 1 }), rawPage(403), now);
    expect(outcome).toMatchObject({ kind: 'other_status', write: { httpStatusCode: 403, consecutiveNotFoundCount: 1 } });
  });

  it('ignores a new URL that does not answer 2xx', () => {
    expect(reconcilePage(undefined, rawPage(404), now)).toEqual({ kind: 'ignored' });
    expect(reconcilePage(undefined, rawPage(403), now)).toEqual({ kind: 'ignored' });
  });
});

describe('sitemapDate', () => {
  it('reads a date or a date and time as ISO 8601', () => {
    expect(sitemapDate('2026-10-01')).toBe('2026-10-01T00:00:00.000Z');
    expect(sitemapDate('2026-10-01T12:30:00+02:00')).toBe('2026-10-01T10:30:00.000Z');
  });

  it('is null for a missing or unreadable lastmod', () => {
    expect(sitemapDate(null)).toBeNull();
    expect(sitemapDate('last week')).toBeNull();
  });

  it('is null for a year the database cannot store', () => {
    // JavaScript reads these as the years 202401, 0 and -1.
    expect(sitemapDate('202401')).toBeNull();
    expect(sitemapDate('0000-01-01T00:00:00Z')).toBeNull();
    expect(sitemapDate('-000001-01-01T00:00:00Z')).toBeNull();
  });
});
