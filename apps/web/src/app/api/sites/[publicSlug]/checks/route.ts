import { checkSiteNow } from '@/server/sites/check-site-now';
import { webServices } from '@/server/composition/web-services';
import { requestedSite } from '@/server/http/requested-site';

// "Check now". Answers 202 with the run to poll, which may be one already in progress, or 429 with Retry-After
// when the site was checked within the cooldown.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { siteId, response } = await requestedSite(services.databasePool, (await params).publicSlug);
    if (response) return response;
    const outcome = await checkSiteNow(siteId, {
      databasePool: services.databasePool,
      queue: await services.queue(),
      checkNowCooldownSeconds: services.config.checkNowCooldownSeconds,
    });
    if (outcome.kind === 'too_soon') {
      return Response.json(
        { error: 'This site was checked a moment ago. Try again later.', retryAfterSeconds: outcome.retryAfterSeconds },
        { status: 429, headers: { 'retry-after': String(outcome.retryAfterSeconds) } },
      );
    }
    return Response.json(
      { pipelineRunId: outcome.pipelineRunId, joinedActiveRun: outcome.kind === 'joined' },
      { status: 202 },
    );
  } catch (error) {
    services.logger.error('check now failed', { error });
    return Response.json({ error: 'The check could not be started.' }, { status: 500 });
  }
}
