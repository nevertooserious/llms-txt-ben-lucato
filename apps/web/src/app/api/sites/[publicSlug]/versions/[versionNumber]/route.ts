import { loadLlmsTxtVersionContent } from '@llms-txt/db';
import { webServices } from '../../../../../../server/web-services';
import { apiError } from '../../../../../../server/api-response';
import { requestedSite } from '../../../../../../server/requested-site';
import { parseVersionNumber } from '../../../../../../server/version-number';

// The text of one version.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string; versionNumber: string }> },
): Promise<Response> {
  const services = webServices();
  const { publicSlug, versionNumber: requestedVersion } = await params;
  try {
    const { siteId, response } = await requestedSite(services.databasePool, publicSlug);
    if (response) return response;
    const versionNumber = parseVersionNumber(requestedVersion);
    const llmsTxtContent =
      versionNumber === null ? null : await loadLlmsTxtVersionContent(services.databasePool, siteId, versionNumber);
    if (llmsTxtContent === null) return apiError(404, 'version_not_found', 'There is no such version.');
    return Response.json({ versionNumber, llmsTxtContent }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('loading version failed', { error });
    return apiError(500, 'internal_error', 'The version could not be loaded.');
  }
}
