import { clientIpFrom } from '../../../server/client-ip';
import { submitSite } from '../../../server/submit-site';
import { webServices } from '../../../server/web-services';

// Submit a URL. The work is in server/submit-site.ts; this handler only parses the
// request and shapes the response.
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const submittedUrl = (body as { url?: unknown } | null)?.url;
  if (typeof submittedUrl !== 'string') {
    return Response.json({ error: 'Send a JSON body with a "url" string.' }, { status: 400 });
  }

  const services = webServices();
  try {
    const outcome = await submitSite(
      { submittedUrl, clientIp: clientIpFrom(request.headers, services.config.trustedProxyHops) },
      {
        databasePool: services.databasePool,
        queue: await services.queue(),
        submissionsPerIpPerHour: services.config.submissionsPerIpPerHour,
      },
    );
    switch (outcome.kind) {
      case 'invalid_url':
        return Response.json({ error: 'That is not an http or https URL.' }, { status: 400 });
      case 'rate_limited':
        return Response.json({ error: 'Too many submissions from this address. Try again later.' }, { status: 429 });
      case 'submitted':
        return Response.json(
          {
            publicSlug: outcome.publicSlug,
            pipelineRunId: outcome.pipelineRunId,
          },
          { status: 202 },
        );
    }
  } catch (error) {
    services.logger.error('submission failed', { error });
    return Response.json({ error: 'The submission could not be saved.' }, { status: 500 });
  }
}
