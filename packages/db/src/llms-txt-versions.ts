import type { Queryable, Transaction } from './transaction';

export interface PublishedVersion {
  id: string;
  versionNumber: number;
  llmsTxtContent: string;
}

/** The version a workspace serves, or null before its first publish. */
export async function loadPublishedVersion(database: Queryable, workspaceId: string): Promise<PublishedVersion | null> {
  const result = await database.query<{ id: string; version_number: number; llms_txt_content: string }>(
    `select versions.id, versions.version_number, versions.llms_txt_content
       from site_workspaces workspaces
       join llms_txt_versions versions on versions.id = workspaces.published_version_id
      where workspaces.id = $1`,
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
 * Appends a version and makes it the published one. The workspace row is locked first,
 * so a user edit and a run cannot take the same version number.
 */
export async function publishLlmsTxtVersion(
  transaction: Transaction,
  version: NewLlmsTxtVersion,
): Promise<{ id: string; versionNumber: number }> {
  await transaction.query('select 1 from site_workspaces where id = $1 for update', [version.workspaceId]);
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
  await transaction.query('update site_workspaces set published_version_id = $2 where id = $1', [
    version.workspaceId,
    row.id,
  ]);
  return { id: row.id, versionNumber: row.version_number };
}
