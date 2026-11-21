import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from './database-pool';
import { saveCrawledPage } from './pages';
import { findOrCreateSite } from './sites';
import { withTransaction } from './transaction';
import {
  createWorkspace,
  deleteWorkspace,
  loadExcludedUrlPrefixes,
  loadWorkspaceOverrides,
  replaceExcludedPages,
  replaceExcludedUrlPrefixes,
} from './workspaces';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

/** A site with pages at `paths`, and a workspace on it. */
async function workspaceWithPages(paths: string[]): Promise<{ id: string; siteId: string; origin: string }> {
  const origin = `https://${randomUUID()}.example`;
  const siteId = await findOrCreateSite(pool, origin);
  const run = await pool.query<{ id: string }>(
    `insert into pipeline_runs (site_id, triggered_by, status, finished_at)
     values ($1, 'submission', 'succeeded', now()) returning id`,
    [siteId],
  );
  for (const path of paths) {
    await saveCrawledPage(pool, siteId, run.rows[0]!.id, {
      normalisedUrl: `${origin}${path}`,
      fetchUrl: `${origin}${path}`,
      httpStatusCode: 200,
      httpEtag: null,
      httpLastModified: null,
      fetchMethod: 'plain_http',
      crawlDepth: 1,
      discoveredVia: 'navigation',
      sitemapLastModifiedAt: null,
      markdownVariantUrl: null,
      hasNoindexDirective: false,
      consecutiveNotFoundCount: 0,
      removedAt: null,
    });
  }
  const id = await createWorkspace(pool, { siteId, accessTokenHash: randomUUID(), publicSlug: randomUUID(), creatorIpHash: null });
  return { id, siteId, origin };
}

const excludedUrlsOf = async (workspaceId: string) =>
  (await loadWorkspaceOverrides(pool, workspaceId)).filter((override) => override.isExcluded).map((override) => override.normalisedUrl);

describe('replaceExcludedPages', () => {
  it('makes the given pages the whole set, and skips URLs that are not pages of the site', async () => {
    const workspace = await workspaceWithPages(['/a', '/b', '/c']);
    const url = (path: string) => `${workspace.origin}${path}`;

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, workspace, [url('/a'), url('/b'), url('/nowhere')]));
    expect(await excludedUrlsOf(workspace.id)).toEqual([url('/a'), url('/b')]);

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, workspace, [url('/b'), url('/c')]));
    expect(await excludedUrlsOf(workspace.id)).toEqual([url('/b'), url('/c')]);

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, workspace, []));
    expect(await excludedUrlsOf(workspace.id)).toEqual([]);
  });

  it('keeps a description override through excluding and including the page', async () => {
    const workspace = await workspaceWithPages(['/a']);
    const url = `${workspace.origin}/a`;
    await pool.query(
      `insert into workspace_page_overrides (workspace_id, page_id, description_override)
       select $1, id, 'Our own words.' from pages where site_id = $2`,
      [workspace.id, workspace.siteId],
    );

    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, workspace, [url]));
    expect(await loadWorkspaceOverrides(pool, workspace.id)).toEqual([
      { normalisedUrl: url, descriptionOverride: 'Our own words.', isExcluded: true },
    ]);
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, workspace, []));
    expect(await loadWorkspaceOverrides(pool, workspace.id)).toEqual([
      { normalisedUrl: url, descriptionOverride: 'Our own words.', isExcluded: false },
    ]);
  });

  it("leaves another workspace's exclusions on the same site alone", async () => {
    const workspace = await workspaceWithPages(['/a']);
    const otherId = await createWorkspace(pool, {
      siteId: workspace.siteId,
      accessTokenHash: randomUUID(),
      publicSlug: randomUUID(),
      creatorIpHash: null,
    });
    const url = `${workspace.origin}/a`;
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, { id: otherId, siteId: workspace.siteId }, [url]));
    await withTransaction(pool, (transaction) => replaceExcludedPages(transaction, workspace, []));
    expect(await excludedUrlsOf(otherId)).toEqual([url]);
  });
});

describe('replaceExcludedUrlPrefixes', () => {
  it('makes the given prefixes the whole set, in order', async () => {
    const workspace = await workspaceWithPages([]);
    const prefix = (path: string) => `${workspace.origin}${path}`;

    await withTransaction(pool, (transaction) =>
      replaceExcludedUrlPrefixes(transaction, workspace.id, [prefix('/docs'), prefix('/blog'), prefix('/blog')]),
    );
    expect(await loadExcludedUrlPrefixes(pool, workspace.id)).toEqual([prefix('/blog'), prefix('/docs')]);

    await withTransaction(pool, (transaction) => replaceExcludedUrlPrefixes(transaction, workspace.id, [prefix('/docs'), prefix('/api')]));
    expect(await loadExcludedUrlPrefixes(pool, workspace.id)).toEqual([prefix('/api'), prefix('/docs')]);

    await withTransaction(pool, (transaction) => replaceExcludedUrlPrefixes(transaction, workspace.id, []));
    expect(await loadExcludedUrlPrefixes(pool, workspace.id)).toEqual([]);
  });

  it('is deleted with its workspace', async () => {
    const workspace = await workspaceWithPages([]);
    await withTransaction(pool, (transaction) => replaceExcludedUrlPrefixes(transaction, workspace.id, [`${workspace.origin}/blog`]));
    await withTransaction(pool, (transaction) => deleteWorkspace(transaction, workspace.id));
    const remaining = await pool.query('select 1 from workspace_excluded_url_prefixes where workspace_id = $1', [workspace.id]);
    expect(remaining.rowCount).toBe(0);
  });
});
