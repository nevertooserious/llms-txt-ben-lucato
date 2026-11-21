import type { PageOverride } from '@llms-txt/contracts';
import type { Queryable, Transaction } from './transaction';

export interface NewSite {
  rootUrl: string;
  publicSlug: string;
  /** SHA-256 of the submitter's IP, for the per-IP rate limit. */
  creatorIpHash: string | null;
}

/** A new, independent site: each submission of a URL gets its own. */
export async function createSite(database: Queryable, site: NewSite): Promise<string> {
  const result = await database.query<{ id: string }>(
    `insert into sites (root_url, public_slug, creator_ip_hash)
     values ($1, $2, $3)
     returning id`,
    [site.rootUrl, site.publicSlug, site.creatorIpHash],
  );
  return result.rows[0]!.id;
}

/** The id of the site served at /w/{publicSlug}, or null. */
export async function loadSiteIdBySlug(database: Queryable, publicSlug: string): Promise<string | null> {
  const result = await database.query<{ id: string }>('select id from sites where public_slug = $1', [publicSlug]);
  return result.rows[0]?.id ?? null;
}

/**
 * Deletes a site with its pages, overrides, runs and versions. A run in progress loses
 * its row, so its next write fails and it cannot publish. False if there was no such site.
 */
export async function deleteSite(database: Queryable, siteId: string): Promise<boolean> {
  const deleted = await database.query('delete from sites where id = $1', [siteId]);
  return deleted.rowCount === 1;
}

/** Sites created from one IP in the last `withinSeconds`, for the submission rate limit. */
export async function countRecentSitesFromIp(
  database: Queryable,
  creatorIpHash: string,
  withinSeconds: number,
): Promise<number> {
  const result = await database.query<{ count: number }>(
    `select count(*)::integer as count from sites
      where creator_ip_hash = $1 and created_at > now() - make_interval(secs => $2)`,
    [creatorIpHash, withinSeconds],
  );
  return result.rows[0]?.count ?? 0;
}

/** The published llms.txt served at /w/{publicSlug}/llms.txt, or null if there is none yet. */
export async function loadPublishedLlmsTxt(database: Queryable, publicSlug: string): Promise<string | null> {
  const result = await database.query<{ llms_txt_content: string }>(
    `select versions.llms_txt_content
       from sites
       join llms_txt_versions versions on versions.id = sites.published_version_id
      where sites.public_slug = $1`,
    [publicSlug],
  );
  return result.rows[0]?.llms_txt_content ?? null;
}

/** The user's edits to a site's pages, applied as inputs on every render. */
export async function loadPageOverrides(database: Queryable, siteId: string): Promise<PageOverride[]> {
  const result = await database.query<{ normalised_url: string; description_override: string | null; is_excluded: boolean }>(
    `select pages.normalised_url, overrides.description_override, overrides.is_excluded
       from page_overrides overrides
       join pages on pages.id = overrides.page_id
      where pages.site_id = $1
      order by pages.normalised_url`,
    [siteId],
  );
  return result.rows.map((row) => ({
    normalisedUrl: row.normalised_url,
    descriptionOverride: row.description_override,
    isExcluded: row.is_excluded,
  }));
}

/** What the site screen shows besides the latest run. */
export interface SiteOverview {
  rootUrl: string;
  siteTitle: string | null;
  /** In the past once monitoring has lapsed; null for a site that never had it. */
  monitoringEnabledUntil: Date | null;
  nextMonitorCheckAt: Date | null;
  isPublishedVersionPinned: boolean;
  publishedVersion: {
    versionNumber: number;
    llmsTxtContent: string;
    listedPageCount: number;
    createdAt: Date;
  } | null;
}

export async function loadSiteOverview(database: Queryable, siteId: string): Promise<SiteOverview | null> {
  const result = await database.query<{
    root_url: string;
    site_title: string | null;
    monitoring_enabled_until: Date | null;
    next_monitor_check_at: Date | null;
    is_published_version_pinned: boolean;
    version_number: number | null;
    llms_txt_content: string | null;
    listed_page_count: number | null;
    version_created_at: Date | null;
  }>(
    `select sites.root_url, sites.site_title, sites.monitoring_enabled_until, sites.next_monitor_check_at,
            sites.is_published_version_pinned,
            versions.version_number, versions.llms_txt_content, versions.listed_page_count,
            versions.created_at as version_created_at
       from sites
       left join llms_txt_versions versions on versions.id = sites.published_version_id
      where sites.id = $1`,
    [siteId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    rootUrl: row.root_url,
    siteTitle: row.site_title,
    monitoringEnabledUntil: row.monitoring_enabled_until,
    nextMonitorCheckAt: row.next_monitor_check_at,
    isPublishedVersionPinned: row.is_published_version_pinned,
    publishedVersion:
      row.version_number === null
        ? null
        : {
            versionNumber: row.version_number,
            llmsTxtContent: row.llms_txt_content!,
            listedPageCount: row.listed_page_count!,
            createdAt: row.version_created_at!,
          },
  };
}

/**
 * Takes up to `limit` sites whose monitor check is due, locking them so two ticks never
 * take the same site, and moves each one's next check on by its interval. A due site
 * whose monitoring has expired is unscheduled instead and not returned. Returns the ids
 * of the sites to check.
 */
export async function claimDueMonitorChecks(transaction: Transaction, limit: number): Promise<string[]> {
  const result = await transaction.query<{ id: string; is_monitored: boolean }>(
    `with due as (
       select id, coalesce(monitoring_enabled_until > now(), false) as is_monitored
         from sites
        where next_monitor_check_at <= now()
        order by next_monitor_check_at
        limit $1
        for update skip locked
     )
     update sites
        set next_monitor_check_at = case when due.is_monitored then now() + sites.monitor_check_interval end,
            last_monitor_check_at = case when due.is_monitored then now() else sites.last_monitor_check_at end
       from due
      where sites.id = due.id
     returning sites.id, due.is_monitored`,
    [limit],
  );
  return result.rows.filter((row) => row.is_monitored).map((row) => row.id);
}

/** Records where a site really lives, once its first crawl has followed the homepage redirect. */
export async function saveResolvedRootUrl(database: Queryable, siteId: string, resolvedRootUrl: string): Promise<void> {
  await database.query('update sites set root_url = $2 where id = $1', [siteId, resolvedRootUrl]);
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
