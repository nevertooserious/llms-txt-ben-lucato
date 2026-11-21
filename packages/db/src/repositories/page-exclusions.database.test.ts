import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../connection/database-pool';
import { withTransaction } from '../connection/transaction';
import { loadExcludedUrlPrefixes, replaceExcludedPages, replaceExcludedUrlPrefixes } from './page-exclusions';
import { saveCrawledPage } from './pages';
import { createSite, deleteSite, loadPageOverrides } from './sites';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

/** A site with pages at `paths`. */
async function siteWithPages(paths: string[]): Promise<{ id: string; origin: string }> {
  const origin = `https://${randomUUID()}.example`;
  const id = await createSite(pool, { rootUrl: origin, publicSlug: randomUUID(), creatorIpHash: null });
  const run = await pool.query<{ id: string }>(
    `insert into pipeline_runs (site_id, triggered_by, status, finished_at)
     values ($1, 'submission', 'succeeded', now()) returning id`,
    [id],
  );
  for (const path of paths) {
    await saveCrawledPage(pool, id, run.rows[0]!.id, {
      normalisedUrl: `${origin}${path}`,
      fetchUrl: `${origin}${path}`,
      httpStatusCode: 200,
      httpEtag: null,
      httpLastModified: null,
      fetchMethod: 'plain_http',
      crawlDepth: 1,
      discoveredVia: 'navigation',
      sitemapLastModifiedAt: null,
      markdownVariantUrl: null,
      outboundLinkUrls: null,
      hasNoindexDirective: false,
      removedAt: null,
    });
  }
  return { id, origin };
}

const excludedUrlsOf = async (siteId: string) =>
  (await loadPageOverrides(pool, siteId)).filter((override) => override.isExcluded).map((override) => override.normalisedUrl);

describe('replaceExcludedPages', () => {
  it('keeps the exclusion of a removed page, which the site screen cannot send', async () => {
    const site = await siteWithPages(['/a', '/gone']);
    const url = (path: string) => `${site.origin}${path}`;
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, [url('/a'), url('/gone')]));
    await pool.query('update pages set removed_at = now() where site_id = $1 and normalised_url = $2', [site.id, url('/gone')]);

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, []));
    expect(await excludedUrlsOf(site.id)).toEqual([url('/gone')]);
    await deleteSite(pool, site.id);
  });

  it('makes the given pages the whole set, and skips URLs that are not pages of the site', async () => {
    const site = await siteWithPages(['/a', '/b', '/c']);
    const url = (path: string) => `${site.origin}${path}`;

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, [url('/a'), url('/b'), url('/nowhere')]));
    expect(await excludedUrlsOf(site.id)).toEqual([url('/a'), url('/b')]);

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, [url('/b'), url('/c')]));
    expect(await excludedUrlsOf(site.id)).toEqual([url('/b'), url('/c')]);

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, []));
    expect(await excludedUrlsOf(site.id)).toEqual([]);
  });

  it('keeps a description override through excluding and including the page', async () => {
    const site = await siteWithPages(['/a']);
    const url = `${site.origin}/a`;
    await pool.query(
      `insert into page_overrides (page_id, description_override)
       select id, 'Our own words.' from pages where site_id = $1`,
      [site.id],
    );

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, [url]));
    expect(await loadPageOverrides(pool, site.id)).toEqual([{ normalisedUrl: url, descriptionOverride: 'Our own words.', isExcluded: true }]);
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, []));
    expect(await loadPageOverrides(pool, site.id)).toEqual([{ normalisedUrl: url, descriptionOverride: 'Our own words.', isExcluded: false }]);
  });

  it("leaves another site's exclusions alone, even for the same URL", async () => {
    const site = await siteWithPages(['/a']);
    const other = await siteWithPages(['/a']);
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, other.id, [`${other.origin}/a`]));
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, [`${other.origin}/a`]));
    expect(await excludedUrlsOf(site.id)).toEqual([]);
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, site.id, []));
    expect(await excludedUrlsOf(other.id)).toEqual([`${other.origin}/a`]);
  });
});

describe('replaceExcludedUrlPrefixes', () => {
  it('makes the given prefixes the whole set, in order', async () => {
    const site = await siteWithPages([]);
    const prefix = (path: string) => `${site.origin}${path}`;

    await withTransaction(pool, (transaction) =>
      replaceExcludedUrlPrefixes(transaction, site.id, [prefix('/docs'), prefix('/blog'), prefix('/blog')]),
    );
    expect(await loadExcludedUrlPrefixes(pool, site.id)).toEqual([prefix('/blog'), prefix('/docs')]);

    await withTransaction(pool, (transaction) => replaceExcludedUrlPrefixes(transaction, site.id, [prefix('/docs'), prefix('/api')]));
    expect(await loadExcludedUrlPrefixes(pool, site.id)).toEqual([prefix('/api'), prefix('/docs')]);

    await withTransaction(pool, (transaction) => replaceExcludedUrlPrefixes(transaction, site.id, []));
    expect(await loadExcludedUrlPrefixes(pool, site.id)).toEqual([]);
  });

  it('is deleted with its site', async () => {
    const site = await siteWithPages([]);
    await withTransaction(pool, (transaction) => replaceExcludedUrlPrefixes(transaction, site.id, [`${site.origin}/blog`]));
    await deleteSite(pool, site.id);
    const remaining = await pool.query('select 1 from excluded_url_prefixes where site_id = $1', [site.id]);
    expect(remaining.rowCount).toBe(0);
  });
});
