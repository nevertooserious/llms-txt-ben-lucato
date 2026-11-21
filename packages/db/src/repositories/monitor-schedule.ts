import type { Transaction } from '../connection/transaction';

export interface MonitorSchedule {
  /** When this site's monitoring lapses. */
  monitoringEnabledUntil: Date;
  /** The site's next scheduled check. */
  nextMonitorCheckAt: Date;
}

/**
 * Starts monitoring for `durationSeconds` from now, or renews it if it is on already.
 * A site with no check scheduled gets one a full interval from now: the site was just
 * crawled by its submission or its last run, so checking sooner finds nothing.
 */
export async function enableSiteMonitoring(
  transaction: Transaction,
  change: { siteId: string; durationSeconds: number },
): Promise<MonitorSchedule> {
  const site = await transaction.query<{ monitoring_enabled_until: Date; next_monitor_check_at: Date }>(
    `update sites
        set monitoring_enabled_until = now() + make_interval(secs => $2),
            next_monitor_check_at = coalesce(next_monitor_check_at, now() + monitor_check_interval)
      where id = $1
      returning monitoring_enabled_until, next_monitor_check_at`,
    [change.siteId, change.durationSeconds],
  );
  const row = site.rows[0];
  if (row === undefined) throw new Error(`no site ${change.siteId}`);
  return { monitoringEnabledUntil: row.monitoring_enabled_until, nextMonitorCheckAt: row.next_monitor_check_at };
}
