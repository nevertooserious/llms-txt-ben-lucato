import { deleteSite } from '@llms-txt/db';
import { loadSiteView } from '@/server/sites/load-site-view';
import { webServices } from '@/server/composition/web-services';
import { requestedSite } from '@/server/http/requested-site';

// The site screen's state, polled while a run is active.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  const { publicSlug } = await params;
  try {
    const { siteId, response } = await requestedSite(services.databasePool, publicSlug);
    if (response) return response;
    const view = await loadSiteView(siteId, publicSlug, { databasePool: services.databasePool });
    if (view === null) return Response.json({ error: 'There is no site here.' }, { status: 404 });
    return Response.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('loading site failed', { error });
    return Response.json({ error: 'The site could not be loaded.' }, { status: 500 });
  }
}

// Deletes the site: its file, hosted URL, crawl data, overrides and version history.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug);
    if (response) return response;
    await deleteSite(services.databasePool, siteId);
    return new Response(null, { status: 204 });
  } catch (error) {
    services.logger.error('deleting site failed', { error });
    return Response.json({ error: 'The site could not be deleted.' }, { status: 500 });
  }
}
