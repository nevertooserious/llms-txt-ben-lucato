import type { Transaction } from '../connection/transaction';

// Starting or renewing a workspace's monitoring. Monitoring belongs to a workspace
// (site_workspaces.monitoring_enabled_until) but the schedule belongs to the site
// (sites.next_monitor_check_at), which is checked while any of its workspaces is
// monitoring. So this writes both tables, under a lock on the site row.

export interface MonitorSchedule {
  /** When this workspace's monitoring lapses. */
  monitoringEnabledUntil: Date;
  /** The site's next scheduled check. */
  nextMonitorCheckAt: Date;
}

export interface WorkspaceMonitoringChange {
  workspaceId: string;
  siteId: string;
}

/**
 * Starts monitoring for `durationSeconds` from now, or renews it if it is on already.
 * A site with no check scheduled gets one a full interval from now: the site was just
 * crawled by its submission or its last run, so checking sooner finds nothing.
 */
export async function enableWorkspaceMonitoring(
  transaction: Transaction,
  change: WorkspaceMonitoringChange & { durationSeconds: number },
): Promise<MonitorSchedule> {
  await lockSite(transaction, change.siteId);
  const workspace = await transaction.query<{ monitoring_enabled_until: Date }>(
    `update site_workspaces
        set monitoring_enabled_until = now() + make_interval(secs => $3)
      where id = $1 and site_id = $2
      returning monitoring_enabled_until`,
    [change.workspaceId, change.siteId, change.durationSeconds],
  );
  if (workspace.rowCount !== 1) throw new Error(`no workspace ${change.workspaceId} on site ${change.siteId}`);
  const site = await transaction.query<{ next_monitor_check_at: Date }>(
    `update sites
        set next_monitor_check_at = coalesce(next_monitor_check_at, now() + monitor_check_interval)
      where id = $1
      returning next_monitor_check_at`,
    [change.siteId],
  );
  return {
    monitoringEnabledUntil: workspace.rows[0]!.monitoring_enabled_until,
    nextMonitorCheckAt: site.rows[0]!.next_monitor_check_at,
  };
}

async function lockSite(transaction: Transaction, siteId: string): Promise<void> {
  const locked = await transaction.query('select 1 from sites where id = $1 for update', [siteId]);
  if (locked.rowCount !== 1) throw new Error(`no site ${siteId}`);
}
