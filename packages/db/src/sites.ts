import type { Queryable, Transaction } from './transaction';

/** The site's id, creating the row on first submission. */
export async function findOrCreateSite(database: Queryable, rootUrl: string): Promise<string> {
  // The no-op update makes `returning` yield the existing row on conflict.
  const result = await database.query<{ id: string }>(
    `insert into sites (root_url) values ($1)
     on conflict (root_url) do update set root_url = excluded.root_url
     returning id`,
    [rootUrl],
  );
  return result.rows[0]!.id;
}

/**
 * Takes up to `limit` sites whose monitor check is due, locking them so two ticks never
 * take the same site, and moves each one's next check on by its interval. A due site
 * with no workspace whose monitoring is unexpired is unscheduled instead and not
 * returned. Returns the ids of the sites to check.
 */
export async function claimDueMonitorChecks(transaction: Transaction, limit: number): Promise<string[]> {
  const result = await transaction.query<{ id: string; is_monitored: boolean }>(
    `with due as (
       select id from sites
        where next_monitor_check_at <= now()
        order by next_monitor_check_at
        limit $1
        for update skip locked
     ), assessed as (
       select due.id,
              exists (select 1 from site_workspaces
                       where site_id = due.id and monitoring_enabled_until > now()) as is_monitored
         from due
     )
     update sites
        set next_monitor_check_at = case when assessed.is_monitored then now() + sites.monitor_check_interval end,
            last_monitor_check_at = case when assessed.is_monitored then now() else sites.last_monitor_check_at end
       from assessed
      where sites.id = assessed.id
     returning sites.id, assessed.is_monitored`,
    [limit],
  );
  return result.rows.filter((row) => row.is_monitored).map((row) => row.id);
}
