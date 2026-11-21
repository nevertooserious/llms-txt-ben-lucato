import { loadWorkspaceView } from '../../../../server/load-workspace-view';
import { webServices } from '../../../../server/web-services';
import { authoriseWorkspaceRequest } from '../../../../server/workspace-access';

// The workspace screen's state, polled while a run is active: GET with the workspace's
// secret token as a bearer token.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const services = webServices();
  const { publicSlug } = await params;
  try {
    const { workspace, response } = await authoriseWorkspaceRequest(services.databasePool, request, publicSlug);
    if (response) return response;
    const view = await loadWorkspaceView(workspace, publicSlug, { databasePool: services.databasePool });
    if (view === null) return Response.json({ error: 'There is no workspace here.' }, { status: 404 });
    return Response.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('loading workspace failed', { error });
    return Response.json({ error: 'The workspace could not be loaded.' }, { status: 500 });
  }
}
