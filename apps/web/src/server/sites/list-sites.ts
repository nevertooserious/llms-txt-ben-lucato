import { listSitesOwnedBy, type Queryable } from '@llms-txt/db';
import type { SiteListEntry } from '../../shared/site-list';

/** A user's sites, newest first. */
export async function listSites(database: Queryable, ownerUserId: string): Promise<SiteListEntry[]> {
  const sites = await listSitesOwnedBy(database, ownerUserId);
  return sites.map((site) => ({
    publicSlug: site.publicSlug,
    rootUrl: site.rootUrl,
    createdAt: site.createdAt.toISOString(),
  }));
}
