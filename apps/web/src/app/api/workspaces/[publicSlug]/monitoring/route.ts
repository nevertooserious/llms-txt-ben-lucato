import { setWorkspaceMonitoring } from '../../../../../server/set-workspace-monitoring';
import { webServices } from '../../../../../server/web-services';
import { authoriseWorkspaceRequest } from '../../../../../server/workspace-access';

// Turn a workspace's monitoring on (or renew it) or off: PUT {"enabled": true | false}
// with the workspace's secret token as a bearer token. Answers with when monitoring
// lapses and when the site is next checked.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const isEnabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof isEnabled !== 'boolean') {
    return Response.json({ error: 'Send a JSON body with an "enabled" boolean.' }, { status: 400 });
  }

  const services = webServices();
  try {
    const { workspace, response } = await authoriseWorkspaceRequest(
      services.databasePool,
      request,
      (await params).publicSlug,
    );
    if (response) return response;
    const schedule = await setWorkspaceMonitoring(workspace, isEnabled, { databasePool: services.databasePool });
    return Response.json({
      monitoringEnabledUntil: schedule.monitoringEnabledUntil?.toISOString() ?? null,
      nextMonitorCheckAt: schedule.nextMonitorCheckAt?.toISOString() ?? null,
    });
  } catch (error) {
    services.logger.error('changing monitoring failed', { error });
    return Response.json({ error: 'Monitoring could not be changed.' }, { status: 500 });
  }
}
