import type { Queryable, Transaction } from '../connection/transaction';

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

/**
 * Holds the site row until the transaction ends. A submission holds the same lock from
 * findOrCreateSite, so a run can finish knowing no workspace is about to join it.
 */
export async function lockSiteRow(transaction: Transaction, siteId: string): Promise<void> {
  await transaction.query('select 1 from sites where id = $1 for update', [siteId]);
}

export type SiteRootAdoption =
  /** No site had the resolved root: this site now does. */
  | { kind: 'renamed'; siteId: string }
  /** Another site already had it: the workspaces and this run moved there. */
  | { kind: 'merged'; siteId: string }
  /** As `merged`, but that site has a run in progress, so this run has nothing left to do. */
  | { kind: 'merged_into_active_run'; siteId: string };

/**
 * Records where a site really lives, once its first crawl has followed the homepage
 * redirect. When another row already holds that root, this site's workspaces and its
 * schedule move there, so the two addresses share one crawl. The emptied row stays: a
 * later submission of the old address finds it and is merged the same way.
 */
export async function adoptResolvedSiteRoot(
  transaction: Transaction,
  change: { siteId: string; pipelineRunId: string; resolvedRootUrl: string },
): Promise<SiteRootAdoption> {
  // Locked in id order, so two merges of the same pair cannot deadlock.
  const locked = await transaction.query<{ id: string; next_monitor_check_at: Date | null }>(
    `select id, next_monitor_check_at from sites where id = $1 or root_url = $2 order by id for update`,
    [change.siteId, change.resolvedRootUrl],
  );
  const target = locked.rows.find((row) => row.id !== change.siteId);
  if (target === undefined) {
    await transaction.query('update sites set root_url = $2 where id = $1', [change.siteId, change.resolvedRootUrl]);
    return { kind: 'renamed', siteId: change.siteId };
  }

  await transaction.query('update site_workspaces set site_id = $2 where site_id = $1', [change.siteId, target.id]);
  const source = locked.rows.find((row) => row.id === change.siteId);
  await transaction.query(
    'update sites set next_monitor_check_at = coalesce(next_monitor_check_at, $2) where id = $1',
    [target.id, source?.next_monitor_check_at ?? null],
  );
  await transaction.query('update sites set next_monitor_check_at = null where id = $1', [change.siteId]);

  const active = await transaction.query(
    `select 1 from pipeline_runs where site_id = $1 and status in ('queued', 'running')`,
    [target.id],
  );
  if ((active.rowCount ?? 0) > 0) return { kind: 'merged_into_active_run', siteId: target.id };
  await transaction.query('update pipeline_runs set site_id = $2 where id = $1', [change.pipelineRunId, target.id]);
  return { kind: 'merged', siteId: target.id };
}

/** How long a headless-rendering decision stands before a crawl makes it again. */
const HEADLESS_DECISION_MAX_AGE = "interval '30 days'";

export interface SiteForRun {
  id: string;
  rootUrl: string;
  siteTitle: string | null;
  generatedSummary: string | null;
  generatedSummarySourceHash: string | null;
  generatedNotes: string[];
  machineReadableResourceUrls: string[];
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
    generated_summary_source_hash: string | null;
    generated_notes: string[];
    machine_readable_resource_urls: string[];
    requires_headless_rendering: boolean | null;
    sitemap_lastmod_is_trusted: boolean;
  }>(
    `select id, root_url, site_title, generated_summary, generated_summary_source_hash, generated_notes,
            machine_readable_resource_urls, sitemap_lastmod_is_trusted,
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
    generatedSummarySourceHash: row.generated_summary_source_hash,
    generatedNotes: row.generated_notes,
    machineReadableResourceUrls: row.machine_readable_resource_urls,
    requiresHeadlessRendering: row.requires_headless_rendering,
    sitemapLastModifiedIsTrusted: row.sitemap_lastmod_is_trusted,
  };
}

export interface SiteCrawlOutcome {
  requiresHeadlessRendering: boolean;
  /** True when this crawl made the rendering decision, which then gets a new timestamp. */
  decidedHeadlessRendering: boolean;
  sitemapLastModifiedIsTrusted: boolean;
  /** Null when the crawl could not tell, so the stored list stands. */
  machineReadableResourceUrls: string[] | null;
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
            sitemap_lastmod_is_trusted = $4,
            machine_readable_resource_urls = coalesce($5, machine_readable_resource_urls)
      where id = $1`,
    [
      siteId,
      outcome.requiresHeadlessRendering,
      outcome.decidedHeadlessRendering,
      outcome.sitemapLastModifiedIsTrusted,
      outcome.machineReadableResourceUrls,
    ],
  );
}

/** The generator's site-level output: the summary, the notes under it, and the hash of their inputs. */
export async function saveGeneratedSummary(
  database: Queryable,
  siteId: string,
  summary: { text: string; notes: string[]; sourceHash: string },
): Promise<void> {
  await database.query(
    'update sites set generated_summary = $2, generated_notes = $3, generated_summary_source_hash = $4 where id = $1',
    [siteId, summary.text, summary.notes, summary.sourceHash],
  );
}

/** The extractor's site-level finding: the homepage's title. */
export async function saveSiteTitle(database: Queryable, siteId: string, siteTitle: string): Promise<void> {
  await database.query('update sites set site_title = $2 where id = $1', [siteId, siteTitle]);
}
