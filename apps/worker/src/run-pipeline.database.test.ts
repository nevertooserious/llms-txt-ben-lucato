import { afterAll, describe, expect, it } from 'vitest';
import type { CrawlFailure, CrawlResult, RawPage } from '@llms-txt/contracts';
import type { CrawlSiteOptions } from '@llms-txt/crawler';
import {
  createDatabasePool,
  createWorkspace,
  findOrCreateSite,
  startPipelineRun,
  withTransaction,
  type PipelineRunQueue,
} from '@llms-txt/db';
import type { GenerateLlmsTxtInput } from '@llms-txt/generator';
import { createLogger } from '@llms-txt/runtime';
import { runPipeline } from './run-pipeline';

// Whole runs against the database, with a stand-in crawler and renderer: the crawler
// and the generator have their own tests; this checks what the worker does between them.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);

afterAll(() => databasePool.end());

const queue = {
  send: async (_name: string, _data: object, options: { id: string; db: { executeSql: (text: string) => Promise<unknown> } }) => {
    await options.db.executeSql('select 1');
    return options.id;
  },
} as unknown as PipelineRunQueue;

interface FakePage {
  path: string;
  status?: number;
  title?: string;
}

const html = (title: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="About ${title}."></head>` +
  `<body><main><h1>${title}</h1><p>Some words about ${title} that are long enough to count as content.</p></main></body></html>`;

/** A crawl that streams the given pages and fails the given number of fetches. */
const fakeCrawl =
  (pages: FakePage[], failedFetchCount = 0) =>
  async (options: CrawlSiteOptions): Promise<CrawlResult> => {
    const urlOf = (page: FakePage) => (page.path === '/' ? options.rootUrl : `${options.rootUrl}${page.path}`);
    for (const page of pages) {
      const url = urlOf(page);
      const status = page.status ?? 200;
      const rawPage: RawPage = {
        normalisedUrl: url,
        fetchUrl: url,
        finalUrl: url,
        httpStatusCode: status,
        headers: {},
        html: status === 200 ? html(page.title ?? page.path) : '',
        fetchMethod: 'plain_http',
        crawlSignals: { crawlDepth: page.path === '/' ? 0 : 1, discoveredVia: 'navigation', hasNoindexDirective: false },
        markdownVariantUrl: null,
        sitemapLastModified: null,
      };
      await options.onPage(rawPage);
    }
    const failedFetches: CrawlFailure[] = Array.from({ length: failedFetchCount }, (_, index) => ({
      url: `${options.rootUrl}/failed-${index}`,
      reason: 'timeout',
      httpStatusCode: null,
      message: 'timed out',
    }));
    return {
      robotsTxtStatus: 'parsed',
      stopReason: 'frontier_exhausted',
      pagesFetchedCount: pages.length,
      linkSignals: Object.fromEntries(
        pages.map((page) => [urlOf(page), { isInSiteNavigation: page.path !== '/', inboundLinkCount: 1 }]),
      ),
      unchangedPerSitemapUrls: [],
      failedFetches,
      requiresHeadlessRendering: false,
      decidedHeadlessRendering: true,
    };
  };

/** A deterministic stand-in for generateLlmsTxt: one entry per listed page. */
const renderLlmsTxt = (input: GenerateLlmsTxtInput) =>
  [`# ${input.siteTitle}`, '', '## Pages', '', ...input.pages.map((page) => `- [${page.record.title}](${page.record.normalisedUrl})`), ''].join('\n');

async function newSiteWithWorkspace(): Promise<{ siteId: string; workspaceId: string; rootUrl: string }> {
  const rootUrl = `https://${crypto.randomUUID()}.example`;
  const siteId = await findOrCreateSite(databasePool, rootUrl);
  const workspaceId = await createWorkspace(databasePool, {
    siteId,
    accessTokenHash: crypto.randomUUID(),
    publicSlug: crypto.randomUUID(),
    creatorIpHash: null,
  });
  return { siteId, workspaceId, rootUrl };
}

async function run(siteId: string, crawl: ReturnType<typeof fakeCrawl>) {
  const outcome = await withTransaction(databasePool, (transaction) =>
    startPipelineRun(transaction, queue, { siteId, triggeredBy: 'monitor', requestedByWorkspaceId: null }),
  );
  const pipelineRunId = outcome.pipelineRunId!;
  await runPipeline(
    { pipelineRunId, siteId },
    {
      databasePool,
      logger: createLogger({ level: 'error', writeLine: () => {} }),
      heartbeatIntervalMs: 60_000,
      settings: { crawlPageBudget: 50, maxFailedFetchShare: 0.5 },
      crawl,
      renderLlmsTxt,
    },
  );
  const result = await databasePool.query<{ status: string; error_message: string | null }>(
    'select status, error_message from pipeline_runs where id = $1',
    [pipelineRunId],
  );
  return result.rows[0]!;
}

async function versions(workspaceId: string) {
  const result = await databasePool.query<{ version_number: number; llms_txt_content: string; page_changes: unknown }>(
    'select version_number, llms_txt_content, page_changes from llms_txt_versions where workspace_id = $1 order by version_number',
    [workspaceId],
  );
  return result.rows;
}

describe('runPipeline', () => {
  it('publishes a first version listing the extracted pages, titled from the homepage', async () => {
    const { siteId, workspaceId, rootUrl } = await newSiteWithWorkspace();
    expect(await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/docs', title: 'Docs' }]))).toEqual({
      status: 'succeeded',
      error_message: null,
    });
    const [first] = await versions(workspaceId);
    expect(first?.version_number).toBe(1);
    expect(first?.llms_txt_content).toContain('# Acme');
    expect(first?.llms_txt_content).toContain(`- [Docs](${rootUrl}/docs)`);
    const docs = await databasePool.query(
      `select is_in_site_navigation, inbound_link_count, page_type, extracted_title from pages
        where site_id = $1 and normalised_url = $2`,
      [siteId, `${rootUrl}/docs`],
    );
    expect(docs.rows[0]).toEqual({ is_in_site_navigation: true, inbound_link_count: 1, page_type: 'docs', extracted_title: 'Docs' });
  });

  it('publishes nothing when nothing changed', async () => {
    const { siteId, workspaceId } = await newSiteWithWorkspace();
    const pages = [{ path: '/', title: 'Acme' }, { path: '/docs', title: 'Docs' }];
    await run(siteId, fakeCrawl(pages));
    expect((await run(siteId, fakeCrawl(pages))).status).toBe('unchanged');
    expect(await versions(workspaceId)).toHaveLength(1);
  });

  it('keeps a page after one 404, removes it after two, and never removes an unreached page', async () => {
    const { siteId, workspaceId, rootUrl } = await newSiteWithWorkspace();
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old' }, { path: '/quiet' }]));

    // /quiet is not reached by the later crawls; /old answers 404 twice.
    expect((await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old', status: 404 }]))).status).toBe('unchanged');
    expect((await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old', status: 404 }]))).status).toBe('succeeded');

    const latest = (await versions(workspaceId)).at(-1)!;
    expect(latest.llms_txt_content).not.toContain(`${rootUrl}/old`);
    expect(latest.llms_txt_content).toContain(`${rootUrl}/quiet`);
    expect(latest.page_changes).toEqual({ added: [], removed: [`${rootUrl}/old`], changed: [] });
  });

  it('fails a run with too many failed fetches, records no 404s, and leaves the published file', async () => {
    const { siteId, workspaceId } = await newSiteWithWorkspace();
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old' }]));
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old', status: 404 }]));

    const failed = await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old', status: 404 }], 5));
    expect(failed.status).toBe('failed');
    expect(failed.error_message).toMatch(/fetches failed/);
    const counter = await databasePool.query<{ consecutive_not_found_count: number; removed_at: Date | null }>(
      `select consecutive_not_found_count, removed_at from pages where site_id = $1 and normalised_url like '%/old'`,
      [siteId],
    );
    expect(counter.rows[0]).toEqual({ consecutive_not_found_count: 1, removed_at: null });
    expect(await versions(workspaceId)).toHaveLength(1);
  });

  it('fails the run with the error when a stage throws', async () => {
    const { siteId } = await newSiteWithWorkspace();
    const outcome = await run(siteId, async () => {
      throw new Error('renderer crashed');
    });
    expect(outcome).toEqual({ status: 'failed', error_message: 'renderer crashed' });
  });
});
