import type { Queryable, Transaction } from './transaction';

export interface NewestVersion {
  id: string;
  versionNumber: number;
  llmsTxtContent: string;
}

/**
 * The workspace's newest version, or null before its first. A run compares its render
 * with this rather than the published version, so a workspace pinned to an older
 * version does not record the same new content on every check.
 */
export async function loadNewestVersion(database: Queryable, workspaceId: string): Promise<NewestVersion | null> {
  const result = await database.query<{ id: string; version_number: number; llms_txt_content: string }>(
    `select id, version_number, llms_txt_content
       from llms_txt_versions
      where workspace_id = $1
      order by version_number desc
      limit 1`,
    [workspaceId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : { id: row.id, versionNumber: row.version_number, llmsTxtContent: row.llms_txt_content };
}

export interface NewLlmsTxtVersion {
  workspaceId: string;
  /** Null for a version made by a user edit. */
  pipelineRunId: string | null;
  createdBy: 'pipeline' | 'user_edit';
  llmsTxtContent: string;
  llmsTxtContentHash: string;
  listedPageCount: number;
  pageChanges: { added: string[]; removed: string[]; changed: string[] };
}

/**
 * Appends a version and makes it the published one, unless the user has pinned another.
 * The workspace row is locked first, so a user edit and a run cannot take the same
 * version number, and a pin cannot be overwritten. Returns null if the workspace has
 * been deleted.
 */
export async function publishLlmsTxtVersion(
  transaction: Transaction,
  version: NewLlmsTxtVersion,
): Promise<{ id: string; versionNumber: number; isLive: boolean } | null> {
  const workspace = await transaction.query('select 1 from site_workspaces where id = $1 for update', [
    version.workspaceId,
  ]);
  if (workspace.rowCount !== 1) return null;
  const inserted = await transaction.query<{ id: string; version_number: number }>(
    `insert into llms_txt_versions (
       workspace_id, pipeline_run_id, version_number, llms_txt_content, llms_txt_content_hash,
       listed_page_count, page_changes, created_by)
     values (
       $1, $2,
       (select coalesce(max(version_number), 0) + 1 from llms_txt_versions where workspace_id = $1),
       $3, $4, $5, $6, $7)
     returning id, version_number`,
    [
      version.workspaceId,
      version.pipelineRunId,
      version.llmsTxtContent,
      version.llmsTxtContentHash,
      version.listedPageCount,
      JSON.stringify(version.pageChanges),
      version.createdBy,
    ],
  );
  const row = inserted.rows[0]!;
  const moved = await transaction.query(
    'update site_workspaces set published_version_id = $2 where id = $1 and not is_published_version_pinned',
    [version.workspaceId, row.id],
  );
  return { id: row.id, versionNumber: row.version_number, isLive: moved.rowCount === 1 };
}

/** Makes one of the workspace's versions live and keeps it there. False if it has no such version. */
export async function pinPublishedVersion(
  transaction: Transaction,
  workspaceId: string,
  versionNumber: number,
): Promise<boolean> {
  await transaction.query('select 1 from site_workspaces where id = $1 for update', [workspaceId]);
  const pinned = await transaction.query(
    `update site_workspaces workspaces
        set published_version_id = versions.id, is_published_version_pinned = true
       from llms_txt_versions versions
      where workspaces.id = $1 and versions.workspace_id = workspaces.id and versions.version_number = $2`,
    [workspaceId, versionNumber],
  );
  return pinned.rowCount === 1;
}

/** Releases a pin and serves the newest version again. False if the workspace is gone. */
export async function unpinPublishedVersion(transaction: Transaction, workspaceId: string): Promise<boolean> {
  await transaction.query('select 1 from site_workspaces where id = $1 for update', [workspaceId]);
  const unpinned = await transaction.query(
    `update site_workspaces workspaces
        set is_published_version_pinned = false,
            published_version_id = coalesce(
              (select id from llms_txt_versions
                where workspace_id = workspaces.id
                order by version_number desc limit 1),
              workspaces.published_version_id)
      where workspaces.id = $1`,
    [workspaceId],
  );
  return unpinned.rowCount === 1;
}

export interface VersionSummary {
  versionNumber: number;
  listedPageCount: number;
  addedPageCount: number;
  removedPageCount: number;
  changedPageCount: number;
  createdAt: Date;
}

/** The newest versions, newest first, always including the published one. */
export async function loadVersionHistory(
  database: Queryable,
  workspaceId: string,
  maxVersions: number,
): Promise<VersionSummary[]> {
  const result = await database.query<{
    version_number: number;
    listed_page_count: number;
    added_page_count: number;
    removed_page_count: number;
    changed_page_count: number;
    created_at: Date;
  }>(
    `select * from (
       select versions.version_number, versions.listed_page_count, versions.created_at,
              jsonb_array_length(coalesce(versions.page_changes -> 'added', '[]'::jsonb)) as added_page_count,
              jsonb_array_length(coalesce(versions.page_changes -> 'removed', '[]'::jsonb)) as removed_page_count,
              jsonb_array_length(coalesce(versions.page_changes -> 'changed', '[]'::jsonb)) as changed_page_count
         from llms_txt_versions versions
         join site_workspaces workspaces on workspaces.id = versions.workspace_id
        where versions.workspace_id = $1
        order by versions.id = workspaces.published_version_id desc nulls last, versions.version_number desc
        limit $2
     ) history
     order by version_number desc`,
    [workspaceId, maxVersions],
  );
  return result.rows.map((row) => ({
    versionNumber: row.version_number,
    listedPageCount: row.listed_page_count,
    addedPageCount: row.added_page_count,
    removedPageCount: row.removed_page_count,
    changedPageCount: row.changed_page_count,
    createdAt: row.created_at,
  }));
}
