import { webServices } from '@/server/composition/web-services';
import { apiError } from '@/server/http/api-response';
import { requestedSite } from '@/server/http/requested-site';
import { loadSitePagesView, parsePageExclusions, savePageExclusions } from '@/server/sites/site-pages';

// The site's crawled pages. GET lists them, with the pages and paths the user ignores and
// the section each page is listed under. PUT { "excludedUrls": [...],
// "excludedUrlPrefixes": [...] } replaces everything that is ignored and renders the file
// again.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug, request);
    if (response) return response;
    const view = await loadSitePagesView(siteId, { databasePool: services.databasePool });
    return Response.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('loading site pages failed', { error });
    return apiError(500, 'internal_error', 'The pages could not be loaded.');
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug, request);
    if (response) return response;
    const exclusions = parsePageExclusions(await request.json().catch(() => null));
    if (exclusions === null) {
      return apiError(400, 'invalid_request', 'Send "excludedUrls" and "excludedUrlPrefixes" as lists of http or https URLs.');
    }
    return Response.json(await savePageExclusions(siteId, exclusions, { databasePool: services.databasePool }));
  } catch (error) {
    services.logger.error('saving ignored pages failed', { error });
    return apiError(500, 'internal_error', 'The ignored pages could not be saved.');
  }
}
