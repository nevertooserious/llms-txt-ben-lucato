import type { PageOverride } from '@llms-txt/contracts';
import { isUniqueViolation } from '../connection/database-errors';
import type { Queryable, Transaction } from '../connection/transaction';

export interface NewSite {
  ownerUserId: string;
  rootUrl: string;
  publicSlug: string;
}

/**
 * A new site. A user has one site per URL, so this throws a unique violation
 * (isUniqueViolation) if they already have this one: see loadOwnedSiteSlugByUrl.
 */
export async function createSite(database: Queryable, site: NewSite): Promise<string> {
  const result = await database.query<{ id: string }>(
    `insert into sites (owner_user_id, root_url, submitted_url, public_slug)
     values ($1, $2, $2, $3)
     returning id`,
    [site.ownerUserId, site.rootUrl, site.publicSlug],
  );
  return result.rows[0]!.id;
}

/**
 * The slug of the user's site for this URL, or null: the site submitted as this URL, or
 * the one whose homepage redirect led to it.
 */
export async function loadOwnedSiteSlugByUrl(
  database: Queryable,
  ownerUserId: string,
  rootUrl: string,
): Promise<string | null> {
  const result = await database.query<{ public_slug: string }>(
    `select public_slug
       from sites
      where owner_user_id = $1 and (root_url = $2 or submitted_url = $2)
      order by created_at, id
      limit 1`,
    [ownerUserId, rootUrl],
  );
  return result.rows[0]?.public_slug ?? null;
}

/** The id of the site served at /w/{publicSlug}, or null. */
export async function loadSiteIdBySlug(database: Queryable, publicSlug: string): Promise<string | null> {
  const result = await database.query<{ id: string }>('select id from sites where public_slug = $1', [publicSlug]);
  return result.rows[0]?.id ?? null;
}

/** The same, but only if the site belongs to this user: someone else's site is not there. */
export async function loadOwnedSiteIdBySlug(
  database: Queryable,
  publicSlug: string,
  ownerUserId: string,
): Promise<string | null> {
  const result = await database.query<{ id: string }>(
    'select id from sites where public_slug = $1 and owner_user_id = $2',
    [publicSlug, ownerUserId],
  );
  return result.rows[0]?.id ?? null;
}

export interface OwnedSite {
  publicSlug: string;
  rootUrl: string;
  createdAt: Date;
}

/** A user's sites, newest first. */
export async function listSitesOwnedBy(database: Queryable, ownerUserId: string): Promise<OwnedSite[]> {
  const result = await database.query<{ public_slug: string; root_url: string; created_at: Date }>(
    `select public_slug, root_url, created_at
     from sites
     where owner_user_id = $1
     order by created_at desc, id`,
    [ownerUserId],
  );
  return result.rows.map((row) => ({ publicSlug: row.public_slug, rootUrl: row.root_url, createdAt: row.created_at }));
}

/**
 * Deletes a site with its pages, overrides, runs and versions. A run in progress loses
 * its row, so its next write fails and it cannot publish. False if there was no such site.
 */
export async function deleteSite(database: Queryable, siteId: string): Promise<boolean> {
  const deleted = await database.query('delete from sites where id = $1', [siteId]);
  return deleted.rowCount === 1;
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
  const result = await database.query<{ normalised_url: string; description_override: string | null; is_excluded: boolean; is_kept: boolean }>(
    `select pages.normalised_url, overrides.description_override, overrides.is_excluded, overrides.is_kept
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
    isKept: row.is_kept,
  }));
}

/** What the site screen shows besides the latest run. */
export interface SiteOverview {
  rootUrl: string;
  siteTitle: string | null;
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
    next_monitor_check_at: Date | null;
    is_published_version_pinned: boolean;
    version_number: number | null;
    llms_txt_content: string | null;
    listed_page_count: number | null;
    version_created_at: Date | null;
  }>(
    `select sites.root_url, coalesce(sites.generated_site_name, sites.site_title) as site_title,
            sites.next_monitor_check_at,
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
 * take the same site, and moves each one's next check on by its interval. Returns the
 * ids of the sites to check.
 */
export async function claimDueMonitorChecks(transaction: Transaction, limit: number): Promise<string[]> {
  const result = await transaction.query<{ id: string }>(
    `with due as (
       select id
         from sites
        where next_monitor_check_at <= now()
        order by next_monitor_check_at
        limit $1
        for update skip locked
     )
     update sites
        set next_monitor_check_at = now() + sites.monitor_check_interval,
            last_monitor_check_at = now()
       from due
      where sites.id = due.id
     returning sites.id`,
    [limit],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Records where a site really lives, once its first crawl has followed the homepage
 * redirect. False, with nothing saved, if its owner already has a site there. Not for use
 * inside a transaction, which the refused write would abort.
 */
export async function saveResolvedRootUrl(database: Queryable, siteId: string, resolvedRootUrl: string): Promise<boolean> {
  try {
    await database.query('update sites set root_url = $2 where id = $1', [siteId, resolvedRootUrl]);
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
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
  /** The site's name from the summary call; null until it has given one. */
  generatedSiteName: string | null;
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
    generated_site_name: string | null;
    machine_readable_resource_urls: string[];
    requires_headless_rendering: boolean | null;
    sitemap_lastmod_is_trusted: boolean;
  }>(
    `select id, root_url, site_title, generated_summary, generated_summary_source_hash, generated_notes,
            generated_site_name, machine_readable_resource_urls, sitemap_lastmod_is_trusted,
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
    generatedSiteName: row.generated_site_name,
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
  summary: { text: string; notes: string[]; siteName: string | null; sourceHash: string },
): Promise<void> {
  await database.query(
    `update sites
        set generated_summary = $2, generated_notes = $3, generated_site_name = $4, generated_summary_source_hash = $5
      where id = $1`,
    [siteId, summary.text, summary.notes, summary.siteName, summary.sourceHash],
  );
}

/** The extractor's site-level finding: the homepage's title. */
export async function saveSiteTitle(database: Queryable, siteId: string, siteTitle: string): Promise<void> {
  await database.query('update sites set site_title = $2 where id = $1', [siteId, siteTitle]);
}
