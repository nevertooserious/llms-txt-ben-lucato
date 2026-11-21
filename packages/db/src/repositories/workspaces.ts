import type { WorkspacePageOverride } from '@llms-txt/contracts';
import { lockSiteRow } from './sites';
import type { Queryable, Transaction } from '../connection/transaction';

export interface NewWorkspace {
  siteId: string;
  /** SHA-256 of the secret link's token; the token itself is never stored. */
  accessTokenHash: string;
  publicSlug: string;
  /** SHA-256 of the submitter's IP, for the per-IP rate limit. */
  creatorIpHash: string | null;
}

export async function createWorkspace(database: Queryable, workspace: NewWorkspace): Promise<string> {
  const result = await database.query<{ id: string }>(
    `insert into site_workspaces (site_id, access_token_hash, public_slug, creator_ip_hash)
     values ($1, $2, $3, $4)
     returning id`,
    [workspace.siteId, workspace.accessTokenHash, workspace.publicSlug, workspace.creatorIpHash],
  );
  return result.rows[0]!.id;
}

export interface WorkspaceAccess {
  id: string;
  siteId: string;
  /** SHA-256 of the secret link's token, to compare with the token a request presents. */
  accessTokenHash: string;
}

/** The workspace served at /w/{publicSlug}, with what is needed to authorise a request for it. */
export async function loadWorkspaceAccess(database: Queryable, publicSlug: string): Promise<WorkspaceAccess | null> {
  const result = await database.query<{ id: string; site_id: string; access_token_hash: string }>(
    'select id, site_id, access_token_hash from site_workspaces where public_slug = $1',
    [publicSlug],
  );
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, siteId: row.site_id, accessTokenHash: row.access_token_hash };
}

/**
 * Deletes a workspace with its overrides and versions. Other workspaces of the site are
 * untouched. The site stops being scheduled once none of its workspaces is monitoring,
 * and its row and crawl data go with its last workspace, unless a run is active: that
 * run still writes to the site, so the row stays. Returns false if there was no such
 * workspace.
 */
export async function deleteWorkspace(transaction: Transaction, workspaceId: string): Promise<boolean> {
  for (;;) {
    const current = await transaction.query<{ site_id: string }>(
      'select site_id from site_workspaces where id = $1',
      [workspaceId],
    );
    const siteId = current.rows[0]?.site_id;
    if (siteId === undefined) return false;

    await lockSiteRow(transaction, siteId);
    const deleted = await transaction.query('delete from site_workspaces where id = $1 and site_id = $2', [
      workspaceId,
      siteId,
    ]);
    // A site merge moved the workspace while this waited for the lock: follow it.
    if (deleted.rowCount !== 1) continue;

    await transaction.query(
      `update sites
          set next_monitor_check_at = case
                when exists (select 1 from site_workspaces
                              where site_id = sites.id and monitoring_enabled_until > now())
                then next_monitor_check_at
              end
        where id = $1`,
      [siteId],
    );
    await transaction.query(
      `delete from sites
        where id = $1
          and not exists (select 1 from site_workspaces where site_id = sites.id)
          and not exists (select 1 from pipeline_runs
                           where site_id = sites.id and status in ('queued', 'running'))`,
      [siteId],
    );
    return true;
  }
}

/** Workspaces created from one IP in the last `withinSeconds`, for the submission rate limit. */
export async function countRecentWorkspacesFromIp(
  database: Queryable,
  creatorIpHash: string,
  withinSeconds: number,
): Promise<number> {
  const result = await database.query<{ count: number }>(
    `select count(*)::integer as count from site_workspaces
      where creator_ip_hash = $1 and created_at > now() - make_interval(secs => $2)`,
    [creatorIpHash, withinSeconds],
  );
  return result.rows[0]?.count ?? 0;
}

/** The published llms.txt served at /w/{publicSlug}/llms.txt, or null if there is none yet. */
export async function loadPublishedLlmsTxt(database: Queryable, publicSlug: string): Promise<string | null> {
  const result = await database.query<{ llms_txt_content: string }>(
    `select versions.llms_txt_content
       from site_workspaces workspaces
       join llms_txt_versions versions on versions.id = workspaces.published_version_id
      where workspaces.public_slug = $1`,
    [publicSlug],
  );
  return result.rows[0]?.llms_txt_content ?? null;
}

export async function loadWorkspaceIdsForSite(database: Queryable, siteId: string): Promise<string[]> {
  const result = await database.query<{ id: string }>(
    'select id from site_workspaces where site_id = $1 order by created_at',
    [siteId],
  );
  return result.rows.map((row) => row.id);
}

/** A workspace's edits, applied as inputs on every render. */
export async function loadWorkspaceOverrides(database: Queryable, workspaceId: string): Promise<WorkspacePageOverride[]> {
  const result = await database.query<{ normalised_url: string; description_override: string | null; is_excluded: boolean }>(
    `select pages.normalised_url, overrides.description_override, overrides.is_excluded
       from workspace_page_overrides overrides
       join pages on pages.id = overrides.page_id
      where overrides.workspace_id = $1
      order by pages.normalised_url`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    normalisedUrl: row.normalised_url,
    descriptionOverride: row.description_override,
    isExcluded: row.is_excluded,
  }));
}

/** What the workspace screen shows besides the latest run. */
export interface WorkspaceOverview {
  rootUrl: string;
  siteTitle: string | null;
  /** In the past once monitoring has lapsed; null for a workspace that never had it. */
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

export async function loadWorkspaceOverview(database: Queryable, workspaceId: string): Promise<WorkspaceOverview | null> {
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
    `select sites.root_url, sites.site_title, workspaces.monitoring_enabled_until, sites.next_monitor_check_at,
            workspaces.is_published_version_pinned,
            versions.version_number, versions.llms_txt_content, versions.listed_page_count,
            versions.created_at as version_created_at
       from site_workspaces workspaces
       join sites on sites.id = workspaces.site_id
       left join llms_txt_versions versions on versions.id = workspaces.published_version_id
      where workspaces.id = $1`,
    [workspaceId],
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
