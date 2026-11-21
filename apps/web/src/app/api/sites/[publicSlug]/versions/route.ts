import { listLlmsTxtVersions } from '@llms-txt/db';
import { webServices } from '@/server/composition/web-services';
import { apiError } from '@/server/http/api-response';
import { requestedSite } from '@/server/http/requested-site';
import type { LlmsTxtVersionSummaryView } from '@/shared/site-view';

// The site's version history, newest first, without the file contents.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug);
    if (response) return response;
    const versions = await listLlmsTxtVersions(services.databasePool, siteId);
    const body: LlmsTxtVersionSummaryView[] = versions.map((version) => ({
      ...version,
      createdAt: version.createdAt.toISOString(),
    }));
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('listing versions failed', { error });
    return apiError(500, 'internal_error', 'The version history could not be loaded.');
  }
}
