import { listLlmsTxtVersions } from '@llms-txt/db';
import { webServices } from '../../../../../server/web-services';
import { authoriseWorkspaceRequest } from '../../../../../server/workspace-access';
import type { LlmsTxtVersionSummaryView } from '../../../../../shared/workspace-view';

// The workspace's version history, newest first, without the file contents. GET with the
// workspace's secret token as a bearer token: only the latest version is public.
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
    const versions = await listLlmsTxtVersions(services.databasePool, workspace.id);
    const body: LlmsTxtVersionSummaryView[] = versions.map((version) => ({
      ...version,
      createdAt: version.createdAt.toISOString(),
    }));
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('listing versions failed', { error });
    return Response.json({ error: 'The version history could not be loaded.' }, { status: 500 });
  }
}
