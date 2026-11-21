import type { Queryable, Transaction } from '../connection/transaction';

// What the user keeps out of a site's file: single pages (page_overrides.is_excluded)
// and whole paths (excluded_url_prefixes). Both are replaced as a set, which is how the
// site screen saves them.

/**
 * Makes `excludedUrls` the site's whole set of excluded pages: those pages are excluded,
 * and any other page that was excluded is included again. Description overrides are
 * kept. URLs that are not pages of the site are skipped. A removed page keeps its
 * exclusion: the site screen does not show it, so its absence from the set is not the
 * user including it again, and it stays out of the file if it comes back.
 */
export async function replaceExcludedPages(
  transaction: Transaction,
  siteId: string,
  excludedUrls: readonly string[],
): Promise<void> {
  await transaction.query(
    `insert into page_overrides (page_id, is_excluded)
     select pages.id, true from pages where pages.site_id = $1 and pages.normalised_url = any($2::text[])
     on conflict (page_id) do update set is_excluded = true, updated_at = now()
       where not page_overrides.is_excluded`,
    [siteId, excludedUrls],
  );
  await transaction.query(
    `update page_overrides overrides
        set is_excluded = false, updated_at = now()
       from pages
      where pages.id = overrides.page_id and pages.site_id = $1
        and overrides.is_excluded and pages.removed_at is null
        and pages.normalised_url <> all($2::text[])`,
    [siteId, excludedUrls],
  );
}

/** The URL prefixes whose pages the user keeps out of the site's file, in order. */
export async function loadExcludedUrlPrefixes(database: Queryable, siteId: string): Promise<string[]> {
  const result = await database.query<{ url_prefix: string }>(
    'select url_prefix from excluded_url_prefixes where site_id = $1 order by url_prefix',
    [siteId],
  );
  return result.rows.map((row) => row.url_prefix);
}

/** Makes `urlPrefixes` the site's whole set of excluded URL prefixes. */
export async function replaceExcludedUrlPrefixes(
  transaction: Transaction,
  siteId: string,
  urlPrefixes: readonly string[],
): Promise<void> {
  await transaction.query('delete from excluded_url_prefixes where site_id = $1 and url_prefix <> all($2::text[])', [
    siteId,
    urlPrefixes,
  ]);
  await transaction.query(
    `insert into excluded_url_prefixes (site_id, url_prefix)
     select $1, unnest($2::text[])
     on conflict (site_id, url_prefix) do nothing`,
    [siteId, urlPrefixes],
  );
}
