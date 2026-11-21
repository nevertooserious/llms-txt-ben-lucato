import { loadSiteIdBySlug, type Queryable } from '@llms-txt/db';

/** For a route handler: the id of the site at `publicSlug`, or the 404 to send. */
export async function requestedSite(
  database: Queryable,
  publicSlug: string,
): Promise<{ siteId: string; response?: never } | { siteId?: never; response: Response }> {
  const siteId = await loadSiteIdBySlug(database, publicSlug);
  if (siteId === null) return { response: Response.json({ error: 'There is no site here.' }, { status: 404 }) };
  return { siteId };
}
