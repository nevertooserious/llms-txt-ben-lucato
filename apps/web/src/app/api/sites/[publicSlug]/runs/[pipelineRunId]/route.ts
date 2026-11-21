import { loadPipelineRunDetail } from '@llms-txt/db';
import { apiError, isPipelineRunId, runApiPath } from '../../../../../../server/api-response';
import { requestedSite } from '../../../../../../server/requested-site';
import { webServices } from '../../../../../../server/web-services';
import { isActiveRunStatus, type PipelineRunDetailView } from '../../../../../../shared/site-view';

/** How soon a client polling an active run should ask again. */
const ACTIVE_RUN_POLL_SECONDS = 2;

// The status of one run. While it is active, Retry-After says when to poll again.
export async function GET(
  _request: Request,
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
    const body: PipelineRunDetailView = {
      ...run,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      llmsTxtUrl: run.versionNumber === null ? null : `${runApiPath(publicSlug, run.id)}/llms.txt`,
    };
    return Response.json(body, {
      headers: {
        'cache-control': 'no-store',
        ...(isActiveRunStatus(run.status) ? { 'retry-after': String(ACTIVE_RUN_POLL_SECONDS) } : {}),
      },
    });
  } catch (error) {
    services.logger.error('loading run failed', { error });
    return apiError(500, 'internal_error', 'The run could not be loaded.');
  }
}
