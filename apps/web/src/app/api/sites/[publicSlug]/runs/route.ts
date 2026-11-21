import { apiError, runApiPath } from '../../../../../server/api-response';
import { checkSiteNow } from '../../../../../server/check-site-now';
import { requestedSite } from '../../../../../server/requested-site';
import { webServices } from '../../../../../server/web-services';

// Re-triggers the site ("check now"). Answers 202 with the run to poll, which may be one
// already in progress, or 429 with Retry-After when the site was checked within the cooldown.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  const { publicSlug } = await params;
  try {
    const { siteId, response } = await requestedSite(services.databasePool, publicSlug);
    if (response) return response;
    const outcome = await checkSiteNow(siteId, {
      databasePool: services.databasePool,
      queue: await services.queue(),
      checkNowCooldownSeconds: services.config.checkNowCooldownSeconds,
    });
    if (outcome.kind === 'too_soon') {
      return Response.json(
        {
          error: 'This site was checked a moment ago. Try again later.',
          code: 'cooldown_active',
          retryAfterSeconds: outcome.retryAfterSeconds,
        },
        { status: 429, headers: { 'retry-after': String(outcome.retryAfterSeconds) } },
      );
    }
    const runUrl = runApiPath(publicSlug, outcome.pipelineRunId);
    return Response.json(
      { pipelineRunId: outcome.pipelineRunId, joinedActiveRun: outcome.kind === 'joined', runUrl },
      { status: 202, headers: { location: runUrl } },
    );
  } catch (error) {
    services.logger.error('check now failed', { error });
    return apiError(500, 'internal_error', 'The check could not be started.');
  }
}
