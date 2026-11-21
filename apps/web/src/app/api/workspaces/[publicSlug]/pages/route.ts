import { webServices } from '../../../../../server/web-services';
import { authoriseWorkspaceRequest } from '../../../../../server/workspace-access';
import { loadWorkspacePagesView, parseWorkspaceExclusions, saveWorkspaceExclusions } from '../../../../../server/workspace-pages';

// The site's crawled pages as this workspace sees them. GET lists them, with the pages
// and paths the workspace ignores and the section each page is listed under.
// PUT { "excludedUrls": [...], "excludedUrlPrefixes": [...] } replaces everything the
// workspace ignores and renders the file again. Both take the workspace's secret token
// as a bearer token.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { workspace, response } = await authoriseWorkspaceRequest(
      services.databasePool,
      request,
      (await params).publicSlug,
    );
    if (response) return response;
    const view = await loadWorkspacePagesView(workspace, { databasePool: services.databasePool });
    return Response.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('loading workspace pages failed', { error });
    return Response.json({ error: 'The pages could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  try {
    const { workspace, response } = await authoriseWorkspaceRequest(
      services.databasePool,
      request,
      (await params).publicSlug,
    );
    if (response) return response;
    const exclusions = parseWorkspaceExclusions(await request.json().catch(() => null));
    if (exclusions === null) {
      return Response.json(
        { error: 'Send "excludedUrls" and "excludedUrlPrefixes" as lists of http or https URLs.' },
        { status: 400 },
      );
    }
    const result = await saveWorkspaceExclusions(workspace, exclusions, { databasePool: services.databasePool });
    return Response.json(result);
  } catch (error) {
    services.logger.error('saving ignored pages failed', { error });
    return Response.json({ error: 'The ignored pages could not be saved.' }, { status: 500 });
  }
}
