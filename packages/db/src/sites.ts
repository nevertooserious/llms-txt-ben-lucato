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

/** How long a headless-rendering decision stands before a crawl makes it again. */
const HEADLESS_DECISION_MAX_AGE = "interval '30 days'";

export interface SiteForRun {
  id: string;
  rootUrl: string;
  siteTitle: string | null;
  generatedSummary: string | null;
  /** Null when undecided, or decided over 30 days ago, so the crawl decides again. */
  requiresHeadlessRendering: boolean | null;
  sitemapLastModifiedIsTrusted: boolean;
}

export async function loadSiteForRun(database: Queryable, siteId: string): Promise<SiteForRun> {
  const result = await database.query<{
    id: string;
    root_url: string;
    site_title: string | null;
    generated_summary: string | null;
    requires_headless_rendering: boolean | null;
    sitemap_lastmod_is_trusted: boolean;
  }>(
    `select id, root_url, site_title, generated_summary, sitemap_lastmod_is_trusted,
            case when headless_rendering_decided_at > now() - ${HEADLESS_DECISION_MAX_AGE}
                 then requires_headless_rendering end as requires_headless_rendering
       from sites
      where id = $1`,
    [siteId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no site ${siteId}`);
  return {
    id: row.id,
    rootUrl: row.root_url,
    siteTitle: row.site_title,
    generatedSummary: row.generated_summary,
    requiresHeadlessRendering: row.requires_headless_rendering,
    sitemapLastModifiedIsTrusted: row.sitemap_lastmod_is_trusted,
  };
}

export interface SiteCrawlOutcome {
  requiresHeadlessRendering: boolean;
  /** True when this crawl made the rendering decision, which then gets a new timestamp. */
  decidedHeadlessRendering: boolean;
  sitemapLastModifiedIsTrusted: boolean;
}

/** The crawler's site-level findings. */
export async function saveSiteCrawlOutcome(
  database: Queryable,
  siteId: string,
  outcome: SiteCrawlOutcome,
): Promise<void> {
  await database.query(
    `update sites
        set requires_headless_rendering = case when $3 then $2 else requires_headless_rendering end,
            headless_rendering_decided_at = case when $3 then now() else headless_rendering_decided_at end,
            sitemap_lastmod_is_trusted = $4
      where id = $1`,
    [siteId, outcome.requiresHeadlessRendering, outcome.decidedHeadlessRendering, outcome.sitemapLastModifiedIsTrusted],
  );
}

/** The extractor's site-level finding: the homepage's title. */
export async function saveSiteTitle(database: Queryable, siteId: string, siteTitle: string): Promise<void> {
  await database.query('update sites set site_title = $2 where id = $1', [siteId, siteTitle]);
}
