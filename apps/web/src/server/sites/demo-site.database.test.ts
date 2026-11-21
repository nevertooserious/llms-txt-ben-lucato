import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool, listLlmsTxtVersions, loadLlmsTxtVersionContent, loadSiteIdBySlug } from '@llms-txt/db';
import { validateLlmsTxt } from '@llms-txt/generator';
import { DEMO_PUBLIC_SLUG, loadDemoSitePath } from './demo-site';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);

afterAll(() => databasePool.end());

describe('db/demo-seed.sql', () => {
  it('creates a demo site with several valid versions and no scheduled crawl', async () => {
    const seed = await readFile(resolve(import.meta.dirname, '../../../../../db/demo-seed.sql'), 'utf8');
    const client = await databasePool.connect();
    try {
      // Rolled back, so the shared test database never holds the demo site.
      await client.query('begin');
      expect(await loadDemoSitePath(client)).toBeNull();
      await client.query(seed);

      expect(await loadDemoSitePath(client)).toBe('/w/demo');
      const siteId = (await loadSiteIdBySlug(client, DEMO_PUBLIC_SLUG))!;

      const versions = await listLlmsTxtVersions(client, siteId);
      expect(versions.map((version) => version.versionNumber)).toEqual([4, 3, 2, 1]);
      const contents = new Set<string>();
      for (const version of versions) {
        const content = await loadLlmsTxtVersionContent(client, siteId, version.versionNumber);
        expect(validateLlmsTxt(content!)).toEqual({ isValid: true, problems: [] });
        expect(content!.split('\n').filter((line) => line.startsWith('- ['))).toHaveLength(version.listedPageCount);
        contents.add(content!);
      }
      expect(contents.size).toBe(4);

      const site = await client.query<{ version_number: number; next_monitor_check_at: Date | null }>(
        `select versions.version_number, sites.next_monitor_check_at
           from sites
           join llms_txt_versions versions on versions.id = sites.published_version_id
          where sites.id = $1`,
        [siteId],
      );
      expect(site.rows[0]).toEqual({ version_number: 4, next_monitor_check_at: null });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
