import { loadOwnedSiteIdBySlug, type Queryable } from '@llms-txt/db';
import { apiError } from './api-response';
import { requiredUser } from './signed-in-user';

/**
 * For a route handler: the id of the signed-in user's site at `publicSlug`, or the
 * response to send. Another user's site answers 404, like a slug that does not exist.
 */
export async function requestedSite(
  database: Queryable,
  publicSlug: string,
  request: Request,
): Promise<{ siteId: string; response?: never } | { siteId?: never; response: Response }> {
  const { userId, response } = requiredUser(request);
  if (response) return { response };
  const siteId = await loadOwnedSiteIdBySlug(database, publicSlug, userId);
  if (siteId === null) return { response: apiError(404, 'site_not_found', 'There is no site here.') };
  return { siteId };
}
