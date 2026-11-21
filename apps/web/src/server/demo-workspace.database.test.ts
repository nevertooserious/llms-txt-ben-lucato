import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool, listLlmsTxtVersions, loadLlmsTxtVersionContent } from '@llms-txt/db';
import { validateLlmsTxt } from '@llms-txt/generator';
import { DEMO_ACCESS_TOKEN, DEMO_PUBLIC_SLUG, loadDemoWorkspacePath } from './demo-workspace';
import { authoriseWorkspace } from './workspace-access';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);

afterAll(() => databasePool.end());

describe('db/demo-seed.sql', () => {
  it('creates a demo workspace with several valid versions and no scheduled crawl', async () => {
    const seed = await readFile(resolve(import.meta.dirname, '../../../../db/demo-seed.sql'), 'utf8');
    const client = await databasePool.connect();
    try {
      // Rolled back, so the shared test database never holds the public demo token.
      await client.query('begin');
      expect(await loadDemoWorkspacePath(client)).toBeNull();
      await client.query(seed);

      expect(await loadDemoWorkspacePath(client)).toBe('/w/demo#token=demo-workspace-token');
      const authorisation = await authoriseWorkspace(client, DEMO_PUBLIC_SLUG, DEMO_ACCESS_TOKEN);
      if (authorisation.kind !== 'authorised') throw new Error('the demo token was refused');

      const versions = await listLlmsTxtVersions(client, authorisation.workspace.id);
      expect(versions.map((version) => version.versionNumber)).toEqual([4, 3, 2, 1]);
      const contents = new Set<string>();
      for (const version of versions) {
        const content = await loadLlmsTxtVersionContent(client, authorisation.workspace.id, version.versionNumber);
        expect(validateLlmsTxt(content!)).toEqual({ isValid: true, problems: [] });
        expect(content!.split('\n').filter((line) => line.startsWith('- ['))).toHaveLength(version.listedPageCount);
        contents.add(content!);
      }
      expect(contents.size).toBe(4);

      const workspace = await client.query<{ version_number: number; next_monitor_check_at: Date | null }>(
        `select versions.version_number, sites.next_monitor_check_at
           from site_workspaces workspaces
           join sites on sites.id = workspaces.site_id
           join llms_txt_versions versions on versions.id = workspaces.published_version_id
          where workspaces.id = $1`,
        [authorisation.workspace.id],
      );
      expect(workspace.rows[0]).toEqual({ version_number: 4, next_monitor_check_at: null });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
