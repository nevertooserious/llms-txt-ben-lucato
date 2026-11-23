import { apiError, hostedLlmsTxtPath, runApiPath, siteApiPath } from '@/server/http/api-response';
import { requiredUser } from '@/server/http/signed-in-user';
import { listSites } from '@/server/sites/list-sites';
import { submitSite } from '@/server/sites/submit-site';
import { webServices } from '@/server/composition/web-services';

// The signed-in user's sites, newest first.
export async function GET(request: Request): Promise<Response> {
  const services = webServices();
  try {
    const { userId, response } = requiredUser(request);
    if (response) return response;
    const sites = await listSites(services.databasePool, userId);
    return Response.json(
      {
        sites: sites.map((site) => ({
          ...site,
          siteUrl: siteApiPath(site.publicSlug),
          llmsTxtUrl: hostedLlmsTxtPath(site.publicSlug),
        })),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    services.logger.error('listing sites failed', { error });
    return apiError(500, 'internal_error', 'The sites could not be listed.');
  }
}

// Submit a URL. The work is in server/sites/submit-site.ts; this handler only parses the
// request and shapes the response.
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const submittedUrl = (body as { url?: unknown } | null)?.url;
  if (typeof submittedUrl !== 'string') {
    return apiError(400, 'invalid_request', 'Send a JSON body with a "url" string.');
  }

  const services = webServices();
  try {
    const { userId, response } = requiredUser(request);
    if (response) return response;
    const outcome = await submitSite(
      { ownerUserId: userId, submittedUrl },
      { databasePool: services.databasePool, queue: await services.queue() },
    );
    switch (outcome.kind) {
      case 'invalid_url':
        return apiError(400, 'invalid_url', 'That is not an http or https URL.');
      case 'already_exists': {
        const siteUrl = siteApiPath(outcome.publicSlug);
        return apiError(409, 'site_already_exists', 'You already have a site for this URL.', {
          headers: { location: siteUrl },
          details: { publicSlug: outcome.publicSlug, siteUrl },
        });
      }
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
