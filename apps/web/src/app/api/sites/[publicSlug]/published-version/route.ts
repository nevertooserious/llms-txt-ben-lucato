import { pinPublishedVersion, unpinPublishedVersion, withTransaction } from '@llms-txt/db';
import { webServices } from '../../../../../server/web-services';
import { requestedSite } from '../../../../../server/requested-site';

/** The largest value of the Postgres `integer` column `version_number`. */
const MAX_VERSION_NUMBER = 2_147_483_647;

// Chooses the version served at the hosted URL. PUT { "versionNumber": n } makes that
// version live and pins it, so later checks record new versions without publishing them.
// DELETE unpins and goes back to serving the newest version.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug);
    if (response) return response;
    const body = (await request.json().catch(() => null)) as { versionNumber?: unknown } | null;
    const versionNumber = body?.versionNumber;
    if (typeof versionNumber !== 'number' || !Number.isInteger(versionNumber) || versionNumber < 1 || versionNumber > MAX_VERSION_NUMBER) {
      return Response.json({ error: 'Send a "versionNumber" that is a positive whole number.' }, { status: 400 });
    }
    const isPinned = await withTransaction(services.databasePool, (transaction) =>
      pinPublishedVersion(transaction, siteId, versionNumber),
    );
    if (!isPinned) return Response.json({ error: 'This site has no such version.' }, { status: 404 });
    return Response.json({ versionNumber, isPinned: true });
  } catch (error) {
    services.logger.error('pinning a version failed', { error });
    return Response.json({ error: 'The version could not be made live.' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug);
    if (response) return response;
    const isUnpinned = await withTransaction(services.databasePool, (transaction) =>
      unpinPublishedVersion(transaction, siteId),
    );
    if (!isUnpinned) return Response.json({ error: 'There is no site here.' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    services.logger.error('unpinning a version failed', { error });
    return Response.json({ error: 'The site could not go back to the latest version.' }, { status: 500 });
  }
}
