import type { Transaction } from '../connection/transaction';

/**
 * Makes sure a site has a monitor check scheduled, and returns when it is. A site with
 * none gets one a full interval from now: the site was just crawled by its submission or
 * its last run, so checking sooner finds nothing.
 */
export async function scheduleSiteMonitoring(transaction: Transaction, siteId: string): Promise<Date> {
  const site = await transaction.query<{ next_monitor_check_at: Date }>(
    `update sites
        set next_monitor_check_at = coalesce(next_monitor_check_at, now() + monitor_check_interval)
      where id = $1
      returning next_monitor_check_at`,
    [siteId],
  );
  const row = site.rows[0];
  if (row === undefined) throw new Error(`no site ${siteId}`);
  return row.next_monitor_check_at;
}
