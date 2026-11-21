import { loadLlmsTxtVersionContent } from '@llms-txt/db';
import { webServices } from '../../../../../../server/web-services';
import { authoriseWorkspaceRequest } from '../../../../../../server/workspace-access';

/** The largest value of the Postgres `integer` column `version_number`. */
const MAX_VERSION_NUMBER = 2_147_483_647;

// The text of one version. GET with the workspace's secret token as a bearer token.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string; versionNumber: string }> },
): Promise<Response> {
  const services = webServices();
  const { publicSlug, versionNumber: requestedVersion } = await params;
  try {
    const { workspace, response } = await authoriseWorkspaceRequest(services.databasePool, request, publicSlug);
    if (response) return response;
    const versionNumber = /^[1-9]\d{0,9}$/.test(requestedVersion) ? Number(requestedVersion) : null;
    const llmsTxtContent =
      versionNumber === null || versionNumber > MAX_VERSION_NUMBER
        ? null
        : await loadLlmsTxtVersionContent(services.databasePool, workspace.id, versionNumber);
    if (llmsTxtContent === null) return Response.json({ error: 'There is no such version.' }, { status: 404 });
    return Response.json({ versionNumber, llmsTxtContent }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    services.logger.error('loading version failed', { error });
    return Response.json({ error: 'The version could not be loaded.' }, { status: 500 });
  }
}
