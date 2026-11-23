import { loadOwnedSiteIdBySlug, type Queryable } from '@llms-txt/db';

// The site db/demo-seed.sql creates, for the default login's user. The seed is applied
// by the local Docker stack and was applied once to the deployment; both set
// DEMO_SITE_ENABLED.
export const DEMO_PUBLIC_SLUG = 'demo';

/** The demo site cannot be deleted: nothing in the app can bring it back. */
export function isDemoSite(publicSlug: string): boolean {
  return publicSlug === DEMO_PUBLIC_SLUG;
}

/** The demo site's path, or null if it is not this user's, or was never seeded. */
export async function loadDemoSitePath(database: Queryable, userId: string): Promise<string | null> {
  return (await loadOwnedSiteIdBySlug(database, DEMO_PUBLIC_SLUG, userId)) === null ? null : `/w/${DEMO_PUBLIC_SLUG}`;
}
