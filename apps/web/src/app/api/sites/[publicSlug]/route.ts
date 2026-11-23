import { deleteSite } from '@llms-txt/db';
import { apiError } from '@/server/http/api-response';
import { isDemoSite } from '@/server/sites/demo-site';
import { loadSiteView } from '@/server/sites/load-site-view';
import { webServices } from '@/server/composition/web-services';
import { requestedSite } from '@/server/http/requested-site';

// The site screen's state, polled while a run is active.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  const { publicSlug } = await params;
  try {
    const { siteId, response } = await requestedSite(services.databasePool, publicSlug, request);
    if (response) return response;
    const view = await loadSiteView(siteId, publicSlug, {
      databasePool: services.databasePool,
      crawlPageBudget: services.config.crawlPageBudget,
    });
    if (view === null) return apiError(404, 'site_not_found', 'There is no site here.');
    return Response.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('loading site failed', { error });
    return apiError(500, 'internal_error', 'The site could not be loaded.');
  }
}

// Deletes the site: its file, hosted URL, crawl data, overrides and version history. The
// demo site is refused, after the ownership check so that other users still get a 404.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { publicSlug } = await params;
    const { siteId, response } = await requestedSite(services.databasePool, publicSlug, request);
    if (response) return response;
    if (isDemoSite(publicSlug)) return apiError(403, 'demo_site_protected', 'The demo site cannot be deleted.');
    await deleteSite(services.databasePool, siteId);
    return new Response(null, { status: 204 });
  } catch (error) {
    services.logger.error('deleting site failed', { error });
    return apiError(500, 'internal_error', 'The site could not be deleted.');
  }
}
