import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createDatabasePool,
  createSite,
  listLlmsTxtVersions,
  loadGeneratorPages,
  loadPublishedLlmsTxt,
  pinPublishedVersion,
  publishLlmsTxtVersion,
  saveCrawledPage,
  saveExtractedPage,
  savePageAssessment,
  withTransaction,
} from '@llms-txt/db';
import { decidePublication, generateLlmsTxt, listedEntries } from '@llms-txt/generator';
import { loadSitePagesView, savePageExclusions } from './site-pages';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);
const dependencies = { databasePool };

afterAll(() => databasePool.end());

interface CrawledSite {
  siteId: string;
  publicSlug: string;
  origin: string;
  pipelineRunId: string;
  url: (path: string) => string;
}

const PATHS = ['/', '/docs/intro', '/docs/setup', '/blog/hello', '/pricing'];

/** A site as a finished first run leaves it: pages stored and extracted, and version 1 published. */
async function crawledSite(options: { isPublished?: boolean; isAssessed?: boolean } = {}): Promise<CrawledSite> {
  const origin = `https://${randomUUID()}.example`;
  const url = (path: string) => (path === '/' ? origin : `${origin}${path}`);
  const publicSlug = randomUUID();
  const siteId = await createSite(databasePool, { rootUrl: origin, publicSlug });
  const run = await databasePool.query<{ id: string }>(
    `insert into pipeline_runs (site_id, triggered_by, status, finished_at)
     values ($1, 'submission', 'succeeded', now()) returning id`,
    [siteId],
  );
  const pipelineRunId = run.rows[0]!.id;
  for (const path of PATHS) {
    await addPage({ siteId, pipelineRunId, url }, path);
    if (path !== '/' && (options.isAssessed ?? true)) {
      await savePageAssessment(databasePool, siteId, url(path), {
        description: `What ${path} is about.`,
        listingValue: 'primary',
        exclusionReason: null,
        pageType: 'other',
        sourceHash: `source of ${path}`,
      });
    }
  }

  if (options.isPublished ?? true) {
    const rendered = generateLlmsTxt({
      siteTitle: new URL(origin).host,
      siteSummary: null,
      pages: await loadGeneratorPages(databasePool, siteId),
      overrides: [],
    });
    const decision = decidePublication(null, rendered);
    if (decision.kind !== 'publish') throw new Error('expected a first version');
    await withTransaction(databasePool, (transaction) =>
      publishLlmsTxtVersion(transaction, { siteId, pipelineRunId, createdBy: 'pipeline', ...decision }),
    );
  }
  return { siteId, publicSlug, origin, pipelineRunId, url };
}

async function addPage(site: { siteId: string; pipelineRunId: string; url: (path: string) => string }, path: string): Promise<void> {
  const normalisedUrl = site.url(path);
  await saveCrawledPage(databasePool, site.siteId, site.pipelineRunId, {
    normalisedUrl,
    fetchUrl: normalisedUrl,
    httpStatusCode: 200,
    httpEtag: null,
    httpLastModified: null,
    fetchMethod: 'plain_http',
    crawlDepth: path === '/' ? 0 : 1,
    discoveredVia: 'navigation',
    sitemapLastModifiedAt: null,
    markdownVariantUrl: null,
    outboundLinkUrls: null,
    hasNoindexDirective: false,
    removedAt: null,
  });
  await saveExtractedPage(databasePool, site.siteId, {
    normalisedUrl,
    canonicalUrl: null,
    title: `Title of ${path}`,
    description: `What ${path} is about.`,
    declaredSiteName: null,
    pageType: path === '/' ? 'home' : 'other',
    languageCode: 'en',
    contentMarkdown: `# Title of ${path}`,
    contentDigest: `digest of ${path}`,
    listingFieldsHash: `hash of ${path}`,
  });
}

const listedUrls = async (site: CrawledSite) => [...listedEntries((await loadPublishedLlmsTxt(databasePool, site.publicSlug))!).keys()];
const noExclusions = { excludedUrls: [], excludedUrlPrefixes: [] };

describe('savePageExclusions', () => {
  it('publishes a user_edit version without the ignored page and the pages under the ignored path', async () => {
    const site = await crawledSite();
    expect(await listedUrls(site)).toHaveLength(4);

    const result = await savePageExclusions(
      site.siteId,
      { excludedUrls: [site.url('/pricing')], excludedUrlPrefixes: [site.url('/docs')] },
      dependencies,
    );
    expect(result).toEqual({ kind: 'published', versionNumber: 2, isLive: true });
    expect(await listedUrls(site)).toEqual([site.url('/blog/hello')]);
    expect((await listLlmsTxtVersions(databasePool, site.siteId))[0]).toMatchObject({
      versionNumber: 2,
      createdBy: 'user_edit',
      listedPageCount: 1,
      removedPageCount: 3,
    });
  });

  it('makes no version when the file reads the same', async () => {
    const site = await crawledSite();
    const exclusions = { excludedUrls: [], excludedUrlPrefixes: [site.url('/docs')] };
    await savePageExclusions(site.siteId, exclusions, dependencies);
    expect(await savePageExclusions(site.siteId, exclusions, dependencies)).toEqual({ kind: 'unchanged' });
    // A path with no pages under it changes nothing yet.
    expect(
      await savePageExclusions(site.siteId, { ...exclusions, excludedUrlPrefixes: [site.url('/docs'), site.url('/api')] }, dependencies),
    ).toEqual({ kind: 'unchanged' });
    expect(await listLlmsTxtVersions(databasePool, site.siteId)).toHaveLength(2);
  });

  it('lists the pages again when the path is no longer ignored', async () => {
    const site = await crawledSite();
    await savePageExclusions(site.siteId, { excludedUrls: [], excludedUrlPrefixes: [site.url('/docs')] }, dependencies);
    expect(await savePageExclusions(site.siteId, noExclusions, dependencies)).toMatchObject({ kind: 'published', versionNumber: 3 });
    expect(await listedUrls(site)).toHaveLength(4);
  });

  it('records the version without making it live when another version is pinned', async () => {
    const site = await crawledSite();
    await withTransaction(databasePool, (transaction) => pinPublishedVersion(transaction, site.siteId, 1));
    const result = await savePageExclusions(site.siteId, { excludedUrls: [site.url('/pricing')], excludedUrlPrefixes: [] }, dependencies);
    expect(result).toEqual({ kind: 'published', versionNumber: 2, isLive: false });
    expect(await listedUrls(site)).toContain(site.url('/pricing'));
  });

  it('only saves the choices while a run is active, for that run to apply', async () => {
    const site = await crawledSite();
    await databasePool.query(`insert into pipeline_runs (site_id, triggered_by, status) values ($1, 'user_check_now', 'running')`, [
      site.siteId,
    ]);
    const result = await savePageExclusions(site.siteId, { excludedUrls: [], excludedUrlPrefixes: [site.url('/docs')] }, dependencies);
    expect(result).toEqual({ kind: 'applied_by_next_run' });
    expect(await listLlmsTxtVersions(databasePool, site.siteId)).toHaveLength(1);
    expect((await loadSitePagesView(site.siteId, dependencies)).excludedUrlPrefixes).toEqual([site.url('/docs')]);
  });

  it('only saves the choices before the first version', async () => {
    const site = await crawledSite({ isPublished: false });
    const result = await savePageExclusions(site.siteId, { excludedUrls: [site.url('/pricing')], excludedUrlPrefixes: [] }, dependencies);
    expect(result).toEqual({ kind: 'applied_by_next_run' });
    expect(await listLlmsTxtVersions(databasePool, site.siteId)).toHaveLength(0);
  });

  it('only saves the choices for a site with no assessed pages, rather than publish an empty file', async () => {
    const site = await crawledSite({ isAssessed: false });
    const result = await savePageExclusions(site.siteId, { excludedUrls: [site.url('/pricing')], excludedUrlPrefixes: [] }, dependencies);
    expect(result).toEqual({ kind: 'applied_by_next_run' });
    expect(await listLlmsTxtVersions(databasePool, site.siteId)).toHaveLength(1);
  });
});

describe('loadSitePagesView', () => {
  it('lists every page with what the user ignores and where the page is listed', async () => {
    const site = await crawledSite();
    await savePageExclusions(
      site.siteId,
      { excludedUrls: [site.url('/pricing')], excludedUrlPrefixes: [site.url('/docs')] },
      dependencies,
    );
    const view = await loadSitePagesView(site.siteId, dependencies);
    expect(view.excludedUrlPrefixes).toEqual([site.url('/docs')]);
    expect(view.pages).toEqual([
      { normalisedUrl: site.url('/'), title: 'Title of /', isHomepage: true, isExcluded: false, listedInSection: null },
      { normalisedUrl: site.url('/blog/hello'), title: 'Title of /blog/hello', isHomepage: false, isExcluded: false, listedInSection: 'Pages' },
      { normalisedUrl: site.url('/docs/intro'), title: 'Title of /docs/intro', isHomepage: false, isExcluded: false, listedInSection: null },
      { normalisedUrl: site.url('/docs/setup'), title: 'Title of /docs/setup', isHomepage: false, isExcluded: false, listedInSection: null },
      { normalisedUrl: site.url('/pricing'), title: 'Title of /pricing', isHomepage: false, isExcluded: true, listedInSection: null },
    ]);
  });

  it('shows a page found later under an ignored path as not listed', async () => {
    const site = await crawledSite();
    await savePageExclusions(site.siteId, { excludedUrls: [], excludedUrlPrefixes: [site.url('/docs')] }, dependencies);
    await addPage(site, '/docs/new');
    const view = await loadSitePagesView(site.siteId, dependencies);
    expect(view.pages.find((page) => page.normalisedUrl === site.url('/docs/new'))).toMatchObject({ listedInSection: null });
    // Rendering again still leaves it out.
    expect(await savePageExclusions(site.siteId, { excludedUrls: [], excludedUrlPrefixes: [site.url('/docs')] }, dependencies)).toEqual({
      kind: 'unchanged',
    });
  });
});
