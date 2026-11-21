import type { WorkspacePageOverride } from '@llms-txt/contracts';
import type { Queryable } from './transaction';

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
