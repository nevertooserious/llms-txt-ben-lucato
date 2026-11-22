import { pinPublishedVersion, unpinPublishedVersion, withTransaction } from '@llms-txt/db';
import { webServices } from '@/server/composition/web-services';
import { apiError } from '@/server/http/api-response';
import { requestedSite } from '@/server/http/requested-site';
import { isVersionNumber } from '@/server/http/version-number';

// Chooses the version served at the hosted URL. PUT { "versionNumber": n } makes that
// version live and pins it, so later checks record new versions without publishing them.
// DELETE unpins and goes back to serving the newest version.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug, request);
    if (response) return response;
    const body = (await request.json().catch(() => null)) as { versionNumber?: unknown } | null;
    const versionNumber = body?.versionNumber;
    if (!isVersionNumber(versionNumber)) {
      return apiError(400, 'invalid_version_number', 'Send a "versionNumber" that is a positive whole number.');
    }
    const isPinned = await withTransaction(services.databasePool, (transaction) =>
      pinPublishedVersion(transaction, siteId, versionNumber),
    );
    if (!isPinned) return apiError(404, 'version_not_found', 'This site has no such version.');
    return Response.json({ versionNumber, isPinned: true });
  } catch (error) {
    services.logger.error('pinning a version failed', { error });
    return apiError(500, 'internal_error', 'The version could not be made live.');
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug, request);
    if (response) return response;
    const isUnpinned = await withTransaction(services.databasePool, (transaction) =>
      unpinPublishedVersion(transaction, siteId),
    );
    if (!isUnpinned) return apiError(404, 'site_not_found', 'There is no site here.');
    return new Response(null, { status: 204 });
  } catch (error) {
    services.logger.error('unpinning a version failed', { error });
    return apiError(500, 'internal_error', 'The site could not go back to the latest version.');
  }
}
