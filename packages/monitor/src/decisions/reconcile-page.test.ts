import { describe, expect, it } from 'vitest';
import type { RawPage } from '@llms-txt/contracts';
import type { StoredPage } from '@llms-txt/db';
import { reconcilePage } from './reconcile-page';

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
  outboundLinkUrls: httpStatusCode >= 200 && httpStatusCode < 300 ? [`${url}/next`] : null,
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
  outboundLinkUrls: [],
  hasNoindexDirective: false,
  removedAt: null,
  contentDigest: 'digest',
  listingFieldsHash: 'hash',
  ...fields,
});

describe('reconcilePage', () => {
  it('saves a 2xx page from this fetch and resets its removal state', () => {
    const outcome = reconcilePage(
      storedPage({ removedAt: '2026-11-01T00:00:00.000Z' }),
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
      outboundLinkUrls: [`${url}/next`],
      removedAt: null,
    });
  });

  it('writes no links for a 304, so the stored ones are kept', () => {
    const outcome = reconcilePage(storedPage({ outboundLinkUrls: [`${url}/stored`] }), rawPage(304), now);
    expect(outcome.kind).toBe('not_modified');
    if (outcome.kind !== 'not_modified') return;
    expect(outcome.write.outboundLinkUrls).toBeNull();
  });

  it('keeps the stored status and what a 304 cannot tell', () => {
    const outcome = reconcilePage(storedPage(), rawPage(304), now);
    expect(outcome.kind).toBe('not_modified');
    if (outcome.kind !== 'not_modified') return;
    expect(outcome.write).toMatchObject({
      httpStatusCode: 200,
      httpEtag: '"v1"',
      markdownVariantUrl: `${url}.md`,
      removedAt: null,
    });
  });

  it.each([404, 410])('removes the page on its first %i', (status) => {
    const outcome = reconcilePage(storedPage(), rawPage(status), now);
    expect(outcome).toMatchObject({
      kind: 'not_found',
      isNewlyRemoved: true,
      write: { httpStatusCode: status, removedAt: now.toISOString(), httpEtag: null },
    });
  });

  it('keeps the original removal time on later 404s', () => {
    const removedAt = '2026-11-01T00:00:00.000Z';
    const outcome = reconcilePage(storedPage({ removedAt }), rawPage(404), now);
    expect(outcome).toMatchObject({ kind: 'not_found', isNewlyRemoved: false, write: { removedAt } });
  });

  it('records another status without removing the page', () => {
    const outcome = reconcilePage(storedPage(), rawPage(403), now);
    expect(outcome).toMatchObject({ kind: 'other_status', write: { httpStatusCode: 403, removedAt: null } });
  });

  it('ignores a new URL that does not answer 2xx', () => {
    expect(reconcilePage(undefined, rawPage(404), now)).toEqual({ kind: 'ignored' });
    expect(reconcilePage(undefined, rawPage(403), now)).toEqual({ kind: 'ignored' });
  });
});
