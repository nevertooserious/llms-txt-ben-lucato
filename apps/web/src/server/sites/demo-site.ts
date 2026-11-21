import { loadSiteIdBySlug, type Queryable } from '@llms-txt/db';

// The site db/demo-seed.sql creates. The seed is applied only by the local Docker stack,
// which is also what sets DEMO_SITE_ENABLED.
export const DEMO_PUBLIC_SLUG = 'demo';

/** The demo site's path, or null once it has been deleted or was never seeded. */
export async function loadDemoSitePath(database: Queryable): Promise<string | null> {
  return (await loadSiteIdBySlug(database, DEMO_PUBLIC_SLUG)) === null ? null : `/w/${DEMO_PUBLIC_SLUG}`;
}
