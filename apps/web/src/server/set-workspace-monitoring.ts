import {
  disableWorkspaceMonitoring,
  enableWorkspaceMonitoring,
  withTransaction,
  type DatabasePool,
  type MonitorSchedule,
  type WorkspaceAccess,
} from '@llms-txt/db';

/**
 * How long monitoring stays on after the user turns it on or renews it. It expires so
 * that abandoned workspaces stop being re-crawled (docs/design/README.md, section 7).
 */
export const MONITORING_DURATION_SECONDS = 30 * 24 * 3600;

/**
 * Turns a workspace's monitoring on (or renews it for another full duration) or off,
 * and schedules or unschedules the site's checks to match.
 */
export async function setWorkspaceMonitoring(
  workspace: WorkspaceAccess,
  isEnabled: boolean,
  dependencies: { databasePool: DatabasePool },
): Promise<MonitorSchedule> {
  const change = { workspaceId: workspace.id, siteId: workspace.siteId };
  return withTransaction(dependencies.databasePool, (transaction) =>
    isEnabled
      ? enableWorkspaceMonitoring(transaction, { ...change, durationSeconds: MONITORING_DURATION_SECONDS })
      : disableWorkspaceMonitoring(transaction, change),
  );
}
