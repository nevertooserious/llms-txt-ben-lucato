import type { Queryable, Transaction } from './transaction';

export interface NewestVersion {
  id: string;
  versionNumber: number;
  llmsTxtContent: string;
}

/**
 * The site's newest version, or null before its first. A run compares its render
 * with this rather than the published version, so a site pinned to an older
 * version does not record the same new content on every check.
 */
export async function loadNewestVersion(database: Queryable, siteId: string): Promise<NewestVersion | null> {
  const result = await database.query<{ id: string; version_number: number; llms_txt_content: string }>(
    `select id, version_number, llms_txt_content
       from llms_txt_versions
      where site_id = $1
      order by version_number desc
      limit 1`,
    [siteId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : { id: row.id, versionNumber: row.version_number, llmsTxtContent: row.llms_txt_content };
}

export interface LlmsTxtVersionSummary {
  versionNumber: number;
  listedPageCount: number;
  addedPageCount: number;
  removedPageCount: number;
  changedPageCount: number;
  createdBy: 'pipeline' | 'user_edit';
  createdAt: Date;
}

/** Every version of a site, newest first, without the file contents. */
export async function listLlmsTxtVersions(database: Queryable, siteId: string): Promise<LlmsTxtVersionSummary[]> {
  const result = await database.query<{
    version_number: number;
    listed_page_count: number;
    added_page_count: number;
    removed_page_count: number;
    changed_page_count: number;
    created_by: 'pipeline' | 'user_edit';
    created_at: Date;
  }>(
    `select version_number, listed_page_count, created_by, created_at,
            jsonb_array_length(coalesce(page_changes -> 'added', '[]'::jsonb)) as added_page_count,
            jsonb_array_length(coalesce(page_changes -> 'removed', '[]'::jsonb)) as removed_page_count,
            jsonb_array_length(coalesce(page_changes -> 'changed', '[]'::jsonb)) as changed_page_count
       from llms_txt_versions
      where site_id = $1
      order by version_number desc`,
    [siteId],
  );
  return result.rows.map((row) => ({
    versionNumber: row.version_number,
    listedPageCount: row.listed_page_count,
    addedPageCount: row.added_page_count,
    removedPageCount: row.removed_page_count,
    changedPageCount: row.changed_page_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

/** The text of one version of a site, or null if it has no such version. */
export async function loadLlmsTxtVersionContent(
  database: Queryable,
  siteId: string,
  versionNumber: number,
): Promise<string | null> {
  const result = await database.query<{ llms_txt_content: string }>(
    `select llms_txt_content
       from llms_txt_versions
      where site_id = $1 and version_number = $2`,
    [siteId, versionNumber],
  );
  return result.rows[0]?.llms_txt_content ?? null;
}

export interface NewLlmsTxtVersion {
  siteId: string;
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
 * The site row is locked first, so a user edit and a run cannot take the same version
 * number, and a pin cannot be overwritten. Returns null if the site has been deleted.
 */
export async function publishLlmsTxtVersion(
  transaction: Transaction,
  version: NewLlmsTxtVersion,
): Promise<{ id: string; versionNumber: number; isLive: boolean } | null> {
  const site = await transaction.query('select 1 from sites where id = $1 for update', [version.siteId]);
  if (site.rowCount !== 1) return null;
  const inserted = await transaction.query<{ id: string; version_number: number }>(
    `insert into llms_txt_versions (
       site_id, pipeline_run_id, version_number, llms_txt_content, llms_txt_content_hash,
       listed_page_count, page_changes, created_by)
     values (
       $1, $2,
       (select coalesce(max(version_number), 0) + 1 from llms_txt_versions where site_id = $1),
       $3, $4, $5, $6, $7)
     returning id, version_number`,
    [
      version.siteId,
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
    'update sites set published_version_id = $2 where id = $1 and not is_published_version_pinned',
    [version.siteId, row.id],
  );
  return { id: row.id, versionNumber: row.version_number, isLive: moved.rowCount === 1 };
}

/** Makes one of the site's versions live and keeps it there. False if it has no such version. */
export async function pinPublishedVersion(
  transaction: Transaction,
  siteId: string,
  versionNumber: number,
): Promise<boolean> {
  await transaction.query('select 1 from sites where id = $1 for update', [siteId]);
  const pinned = await transaction.query(
    `update sites
        set published_version_id = versions.id, is_published_version_pinned = true
       from llms_txt_versions versions
      where sites.id = $1 and versions.site_id = sites.id and versions.version_number = $2`,
    [siteId, versionNumber],
  );
  return pinned.rowCount === 1;
}

/** Releases a pin and serves the newest version again. False if the site is gone. */
export async function unpinPublishedVersion(transaction: Transaction, siteId: string): Promise<boolean> {
  await transaction.query('select 1 from sites where id = $1 for update', [siteId]);
  const unpinned = await transaction.query(
    `update sites
        set is_published_version_pinned = false,
            published_version_id = coalesce(
              (select id from llms_txt_versions
                where site_id = sites.id
                order by version_number desc limit 1),
              sites.published_version_id)
      where sites.id = $1`,
    [siteId],
  );
  return unpinned.rowCount === 1;
}
