import { loadLlmsTxtVersionFile } from '@llms-txt/db';
import { apiError, llmsTxtFileResponse } from '@/server/http/api-response';
import { requestedSite } from '@/server/http/requested-site';
import { parseVersionNumber } from '@/server/http/version-number';
import { webServices } from '@/server/composition/web-services';

// One version's file, as text/plain.
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
    const file = versionNumber === null ? null : await loadLlmsTxtVersionFile(services.databasePool, siteId, versionNumber);
    if (file === null) return apiError(404, 'version_not_found', 'There is no such version.');
    return llmsTxtFileResponse(file);
  } catch (error) {
    services.logger.error('loading a version file failed', { error });
    return apiError(500, 'internal_error', 'The file could not be loaded.');
  }
}
