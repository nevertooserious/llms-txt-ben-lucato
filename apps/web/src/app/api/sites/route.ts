import { apiError, hostedLlmsTxtPath, runApiPath } from '../../../server/api-response';
import { clientIpFrom } from '../../../server/client-ip';
import { submitSite } from '../../../server/submit-site';
import { webServices } from '../../../server/web-services';

// Submit a URL. The work is in server/submit-site.ts; this handler only parses the
// request and shapes the response.
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const submittedUrl = (body as { url?: unknown } | null)?.url;
  if (typeof submittedUrl !== 'string') {
    return apiError(400, 'invalid_request', 'Send a JSON body with a "url" string.');
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
        return apiError(400, 'invalid_url', 'That is not an http or https URL.');
      case 'rate_limited':
        return apiError(429, 'rate_limited', 'Too many submissions from this address. Try again later.');
      case 'submitted': {
        const runUrl = runApiPath(outcome.publicSlug, outcome.pipelineRunId);
        return Response.json(
          {
            publicSlug: outcome.publicSlug,
            pipelineRunId: outcome.pipelineRunId,
            runUrl,
            llmsTxtUrl: hostedLlmsTxtPath(outcome.publicSlug),
          },
          { status: 202, headers: { location: runUrl } },
        );
      }
    }
  } catch (error) {
    services.logger.error('submission failed', { error });
    return apiError(500, 'internal_error', 'The submission could not be saved.');
  }
}
