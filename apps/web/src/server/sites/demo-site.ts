import { loadOwnedSiteIdBySlug, type Queryable } from '@llms-txt/db';

// The site db/demo-seed.sql creates, for the default login's user. The seed is applied
// only by the local Docker stack, which is also what sets DEMO_SITE_ENABLED.
export const DEMO_PUBLIC_SLUG = 'demo';

/** The demo site's path, or null if it is not this user's, has been deleted or was never seeded. */
export async function loadDemoSitePath(database: Queryable, userId: string): Promise<string | null> {
  return (await loadOwnedSiteIdBySlug(database, DEMO_PUBLIC_SLUG, userId)) === null ? null : `/w/${DEMO_PUBLIC_SLUG}`;
}
