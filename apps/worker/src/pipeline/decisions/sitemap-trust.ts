import type { RawPage } from '@llms-txt/contracts';
import type { StoredPage } from '@llms-txt/db';
import { sitemapDate } from './reconcile-page';

// Whether a site's sitemap <lastmod> can stand in for fetching a page
// (sites.sitemap_lastmod_is_trusted). Learned from pages fetched in full that have both
// an old and a new lastmod and an old and a new content digest.

/** Observations a run needs, with no misses, before lastmod is trusted. */
const OBSERVATIONS_BEFORE_TRUST = 5;

export interface SitemapLastModifiedObservation {
  lastModifiedChanged: boolean;
  contentChanged: boolean;
}

export function observeSitemapLastModified(
  stored: StoredPage | undefined,
  page: RawPage,
  contentDigest: string,
): SitemapLastModifiedObservation | null {
  const before = stored?.sitemapLastModifiedAt ?? null;
  const after = sitemapDate(page.sitemapLastModified);
  if (before === null || after === null || stored?.contentDigest == null) return null;
  return { lastModifiedChanged: before !== after, contentChanged: stored.contentDigest !== contentDigest };
}

/**
 * One page whose content changed under an unchanged lastmod withdraws trust. Trust is
 * given when enough pages were observed, none was a miss, and at least one content
 * change was flagged by its lastmod. Otherwise the current answer stands.
 *
 * Once trusted, pages with an unchanged lastmod are not fetched, so a later miss can
 * only be seen on a full crawl.
 */
export function assessSitemapLastModifiedTrust(
  isTrusted: boolean,
  observations: readonly SitemapLastModifiedObservation[],
): boolean {
  if (observations.some((observation) => observation.contentChanged && !observation.lastModifiedChanged)) return false;
  const flaggedChanges = observations.filter((observation) => observation.contentChanged).length;
  if (observations.length >= OBSERVATIONS_BEFORE_TRUST && flaggedChanges > 0) return true;
  return isTrusted;
}
