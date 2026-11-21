import { loadLlmsTxtVersionFile, loadPipelineRunDetail } from '@llms-txt/db';
import { apiError, isPipelineRunId, llmsTxtFileResponse } from '@/server/http/api-response';
import { requestedSite } from '@/server/http/requested-site';
import { webServices } from '@/server/composition/web-services';
import { isActiveRunStatus } from '@/shared/site-view';

// The file a run published, as text/plain. A run that changed nothing or failed published
// none, and this says so instead of answering with some other run's file.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string; pipelineRunId: string }> },
): Promise<Response> {
  const services = webServices();
  const { publicSlug, pipelineRunId } = await params;
  try {
    const { siteId, response } = await requestedSite(services.databasePool, publicSlug);
    if (response) return response;
    const run = isPipelineRunId(pipelineRunId)
      ? await loadPipelineRunDetail(services.databasePool, siteId, pipelineRunId)
      : null;
    if (run === null) return apiError(404, 'run_not_found', 'This site has no such run.');
    if (isActiveRunStatus(run.status)) {
      return apiError(409, 'run_in_progress', 'This run has not finished.', { 'retry-after': '2' });
    }
    const file =
      run.versionNumber === null ? null : await loadLlmsTxtVersionFile(services.databasePool, siteId, run.versionNumber);
    if (file === null) {
      return apiError(404, 'run_produced_no_version', `This run ended as "${run.status}" and published no new version.`);
    }
    return llmsTxtFileResponse(request, file);
  } catch (error) {
    services.logger.error('loading a run file failed', { error });
    return apiError(500, 'internal_error', 'The file could not be loaded.');
  }
}
