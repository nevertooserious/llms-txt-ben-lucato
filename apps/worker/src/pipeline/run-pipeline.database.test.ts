import { afterAll, describe, expect, it } from 'vitest';
import type { CrawlFailure, CrawlResult, RawPage } from '@llms-txt/contracts';
import type { CrawlSiteOptions } from '@llms-txt/crawler';
import {
  createDatabasePool,
  createSite,
  createUserIfAbsent,
  deleteSite,
  startPipelineRun,
  withTransaction,
  type PipelineRunQueue,
} from '@llms-txt/db';
import { generateLlmsTxt, LlmOutputRejectedError, type GenerateLlmsTxtInput, type LlmClient } from '@llms-txt/generator';
import { createLogger } from '@llms-txt/runtime';
import { runPipeline } from './run-pipeline';

/** Sites need an owner; these tests are not about who it is. */
const TEST_OWNER = { username: 'test-owner', passwordHash: 'matches no password' };

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
        outboundLinkUrls: status === 200 ? [] : null,
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
      pagesWithContentCount: pages.filter((page) => (page.status ?? 200) === 200).length,
      linkSignals: Object.fromEntries(
        pages.map((page, index) => [
          urlOf(page),
          // Linked in the order given, as a homepage listing them would.
          { isInSiteNavigation: page.path !== '/', inboundLinkCount: 1, navigationLabel: null, navigationPosition: null, firstLinkPosition: index },
        ]),
      ),
      unchangedPerSitemapUrls: [],
      failedFetches,
      requiresHeadlessRendering: false,
      decidedHeadlessRendering: true,
      machineReadableResourceUrls: [],
    };
  };

/** A deterministic stand-in for generateLlmsTxt: one entry per listed page. */
const renderLlmsTxt = (input: GenerateLlmsTxtInput) =>
  [`# ${input.siteTitle}`, '', '## Pages', '', ...input.pages.map((page) => `- [${page.record.title}](${page.record.normalisedUrl})`), ''].join('\n');

async function newSite(): Promise<{ siteId: string; rootUrl: string }> {
  const rootUrl = `https://${crypto.randomUUID()}.example`;
  const siteId = await createSite(databasePool, {
    ownerUserId: (await createUserIfAbsent(databasePool, TEST_OWNER)).id,
    rootUrl, publicSlug: crypto.randomUUID() });
  return { siteId, rootUrl };
}

async function run(
  siteId: string,
  crawl: ReturnType<typeof fakeCrawl>,
  resolveRootUrl: (rootUrl: string) => Promise<string> = async (rootUrl) => rootUrl,
  pool: typeof databasePool = databasePool,
  llmClient: LlmClient | null = null,
) {
  const outcome = await withTransaction(databasePool, (transaction) =>
    startPipelineRun(transaction, queue, { siteId, triggeredBy: 'monitor' }),
  );
  const pipelineRunId = outcome.pipelineRunId!;
  await runPipeline(
    { pipelineRunId, siteId },
    {
      databasePool: pool,
      logger: createLogger({ level: 'error', writeLine: () => {} }),
      heartbeatIntervalMs: 60_000,
      settings: { crawlPageBudget: 50, maxFailedFetchShare: 0.5 },
      crawl,
      renderLlmsTxt: llmClient === null ? renderLlmsTxt : generateLlmsTxt,
      resolveRootUrl,
      llmClient: llmClient ?? fakeLlmClient().client,
    },
  );
  const result = await databasePool.query<{ status: string; error_message: string | null }>(
    'select status, error_message from pipeline_runs where id = $1',
    [pipelineRunId],
  );
  return result.rows[0]!;
}

async function versions(siteId: string) {
  const result = await databasePool.query<{ version_number: number; llms_txt_content: string; page_changes: unknown }>(
    'select version_number, llms_txt_content, page_changes from llms_txt_versions where site_id = $1 order by version_number',
    [siteId],
  );
  return result.rows;
}

/** A stand-in LLM that excludes not-found and blog-post pages and counts its calls. */
function fakeLlmClient() {
  const calls = { assessPage: 0, writeSiteSummary: 0 };
  const behaviour = { failWith: null as Error | null };
  const client: LlmClient = {
    async assessPage(input) {
      calls.assessPage += 1;
      if (behaviour.failWith !== null) throw behaviour.failWith;
      if (input.url.endsWith('/gone')) {
        return { description: '', listingValue: 'exclude', exclusionReason: 'error_page', scope: 'broad', pageType: 'other' };
      }
      if (input.url.includes('/blog/')) {
        return { description: 'One post.', listingValue: 'exclude', exclusionReason: 'individual_content', scope: 'broad', pageType: 'blog' };
      }
      return { description: `Assessed ${input.title}.`, listingValue: 'primary', exclusionReason: null, scope: 'broad', pageType: 'docs' };
    },
    async writeSiteSummary() {
      calls.writeSiteSummary += 1;
      if (behaviour.failWith !== null) throw behaviour.failWith;
      return { summary: 'Acme, summarised.', notes: ['The v1 API is deprecated.'] };
    },
  };
  return { client, calls, behaviour };
}

const identity = async (rootUrl: string) => rootUrl;

describe('runPipeline with an LLM', () => {
  const pages = [
    { path: '/', title: 'Acme' },
    { path: '/docs', title: 'Docs' },
    { path: '/gone', title: 'Page not found' },
    { path: '/blog/launch', title: 'We launched' },
  ];

  it('lists only the pages the assessment keeps, with its descriptions and summary', async () => {
    const { siteId, rootUrl } = await newSite();
    const llm = fakeLlmClient();
    expect((await run(siteId, fakeCrawl(pages), identity, databasePool, llm.client)).status).toBe('succeeded');
    const content = (await versions(siteId))[0]!.llms_txt_content;
    expect(content).toContain('> Acme, summarised.\n\n- The v1 API is deprecated.\n');
    expect(content).toContain(`- [Docs](${rootUrl}/docs): Assessed Docs.`);
    expect(content).not.toContain('/gone');
    expect(content).not.toContain('/blog/launch');
    const stored = await databasePool.query(
      `select listing_value, exclusion_reason from pages where site_id = $1 and normalised_url = $2`,
      [siteId, `${rootUrl}/gone`],
    );
    expect(stored.rows[0]).toEqual({ listing_value: 'exclude', exclusion_reason: 'error_page' });
  });

  it('does not ask again for unchanged pages, and publishes nothing new', async () => {
    const { siteId } = await newSite();
    const llm = fakeLlmClient();
    await run(siteId, fakeCrawl(pages), identity, databasePool, llm.client);
    expect(llm.calls).toEqual({ assessPage: 3, writeSiteSummary: 1 });
    expect((await run(siteId, fakeCrawl(pages), identity, databasePool, llm.client)).status).toBe('unchanged');
    expect(llm.calls).toEqual({ assessPage: 3, writeSiteSummary: 1 });
    expect(await versions(siteId)).toHaveLength(1);
  });

  it('fails the run and keeps the file when the LLM is down for a new page', async () => {
    const { siteId } = await newSite();
    const llm = fakeLlmClient();
    await run(siteId, fakeCrawl(pages), identity, databasePool, llm.client);
    llm.behaviour.failWith = new Error('overloaded');
    const failed = await run(siteId, fakeCrawl([...pages, { path: '/pricing', title: 'Pricing' }]), identity, databasePool, llm.client);
    expect(failed.status).toBe('failed');
    expect(failed.error_message).toMatch(/could not be reached/);
    expect(await versions(siteId)).toHaveLength(1);
  });

  it('keeps an older assessment when the LLM is down for a changed page', async () => {
    const { siteId, rootUrl } = await newSite();
    const llm = fakeLlmClient();
    await run(siteId, fakeCrawl(pages), identity, databasePool, llm.client);
    llm.behaviour.failWith = new Error('overloaded');
    const changed = pages.map((page) => (page.path === '/docs' ? { ...page, title: 'Docs v2' } : page));
    expect((await run(siteId, fakeCrawl(changed), identity, databasePool, llm.client)).status).not.toBe('failed');
    expect((await versions(siteId)).at(-1)!.llms_txt_content).toContain(`(${rootUrl}/docs): Assessed Docs.`);
  });

  it('leaves out a new page the model will not assess, and still publishes', async () => {
    const { siteId, rootUrl } = await newSite();
    const llm = fakeLlmClient();
    const assessPage = llm.client.assessPage;
    llm.client.assessPage = async (input) => {
      if (input.url.endsWith('/docs')) throw new LlmOutputRejectedError('the model stopped with refusal');
      return assessPage(input);
    };
    const withPricing = [...pages, { path: '/pricing', title: 'Pricing' }];
    expect((await run(siteId, fakeCrawl(withPricing), identity, databasePool, llm.client)).status).toBe('succeeded');
    const content = (await versions(siteId))[0]!.llms_txt_content;
    expect(content).toContain(`${rootUrl}/pricing`);
    expect(content).not.toContain(`${rootUrl}/docs`);
  });
});

describe('runPipeline', () => {
  it('publishes a first version listing the extracted pages, titled from the homepage', async () => {
    const { siteId, rootUrl } = await newSite();
    expect(await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/docs', title: 'Docs' }]))).toEqual({
      status: 'succeeded',
      error_message: null,
    });
    const [first] = await versions(siteId);
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
    const { siteId } = await newSite();
    const pages = [{ path: '/', title: 'Acme' }, { path: '/docs', title: 'Docs' }];
    await run(siteId, fakeCrawl(pages));
    expect((await run(siteId, fakeCrawl(pages))).status).toBe('unchanged');
    expect(await versions(siteId)).toHaveLength(1);
  });

  it('removes a page on a 404 and never removes an unreached page', async () => {
    const { siteId, rootUrl } = await newSite();
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old' }, { path: '/quiet' }]));

    // /quiet is not reached by the later crawl; /old answers 404.
    expect((await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old', status: 404 }]))).status).toBe('succeeded');

    const latest = (await versions(siteId)).at(-1)!;
    expect(latest.llms_txt_content).not.toContain(`${rootUrl}/old`);
    expect(latest.llms_txt_content).toContain(`${rootUrl}/quiet`);
    expect(latest.page_changes).toEqual({ added: [], removed: [`${rootUrl}/old`], changed: [] });
  });

  it('fails a first run that finds nothing to list, but lets a published file lose its last page', async () => {
    const onlyHomepage = await newSite();
    const failed = await run(onlyHomepage.siteId, fakeCrawl([{ path: '/', title: 'Acme' }]));
    expect(failed).toMatchObject({ status: 'failed', error_message: expect.stringContaining('No page besides the homepage') });
    expect(await versions(onlyHomepage.siteId)).toHaveLength(0);

    const { siteId } = await newSite();
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old' }]));
    const emptied = await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old', status: 404 }]));
    expect(emptied.status).toBe('succeeded');
    const published = await versions(siteId);
    expect(published).toHaveLength(2);
    expect(published.at(-1)!.llms_txt_content).not.toContain('/old');
  });

  it('stores the link order each crawl computes', async () => {
    const { siteId } = await newSite();
    const positions = async () => {
      const result = await databasePool.query<{ path: string; first_link_position: number | null }>(
        `select regexp_replace(normalised_url, '^https://[^/]+', '') as path, first_link_position
           from pages where site_id = $1 order by first_link_position`,
        [siteId],
      );
      return result.rows.map((row) => [row.path, row.first_link_position]);
    };
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/zebra' }, { path: '/apple' }]));
    expect(await positions()).toEqual([['', 0], ['/zebra', 1], ['/apple', 2]]);

    // The site's links moved, and a new page sits between them: the stored order follows.
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/apple' }, { path: '/new' }, { path: '/zebra' }]));
    expect(await positions()).toEqual([['', 0], ['/apple', 1], ['/new', 2], ['/zebra', 3]]);
  });

  it('fails a run with too many failed fetches, records no 404s, and leaves the published file', async () => {
    const { siteId } = await newSite();
    await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old' }]));

    const failed = await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/old', status: 404 }], 5));
    expect(failed.status).toBe('failed');
    expect(failed.error_message).toMatch(/fetches failed/);
    const stored = await databasePool.query<{ removed_at: Date | null }>(
      `select removed_at from pages where site_id = $1 and normalised_url like '%/old'`,
      [siteId],
    );
    expect(stored.rows[0]).toEqual({ removed_at: null });
    expect(await versions(siteId)).toHaveLength(1);
  });

  it('moves a first crawl to the root its homepage redirects to', async () => {
    const { siteId } = await newSite();
    const resolvedRootUrl = `https://www.${crypto.randomUUID()}.example`;
    const outcome = await run(siteId, fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/docs', title: 'Docs' }]), async () => resolvedRootUrl);
    expect(outcome.status).toBe('succeeded');
    const site = await databasePool.query<{ root_url: string }>('select root_url from sites where id = $1', [siteId]);
    expect(site.rows[0]?.root_url).toBe(resolvedRootUrl);
    expect((await versions(siteId))[0]?.llms_txt_content).toContain(`${resolvedRootUrl}/docs`);
  });

  it('fails a first crawl that redirects to a site its owner already has', async () => {
    const pages = [{ path: '/', title: 'Acme' }, { path: '/docs', title: 'Docs' }];
    const existing = await newSite();
    await run(existing.siteId, fakeCrawl(pages));
    const redirecting = await newSite();

    const outcome = await run(redirecting.siteId, fakeCrawl(pages), async () => existing.rootUrl);
    expect(outcome.status).toBe('failed');
    expect(outcome.error_message).toBe(`This address redirects to ${existing.rootUrl}, which you already have a site for.`);
    const roots = await databasePool.query<{ root_url: string }>('select root_url from sites where id = $1', [redirecting.siteId]);
    expect(roots.rows).toEqual([{ root_url: redirecting.rootUrl }]);
    expect(await versions(redirecting.siteId)).toHaveLength(0);
    expect(await versions(existing.siteId)).toHaveLength(1);
  });

  it('publishes nothing for a site deleted during its run', async () => {
    const { siteId } = await newSite();
    const crawl = fakeCrawl([{ path: '/', title: 'Acme' }, { path: '/docs', title: 'Docs' }]);
    await run(siteId, async (options) => {
      await deleteSite(databasePool, siteId);
      return crawl(options);
    });
    expect(await versions(siteId)).toHaveLength(0);
    expect((await databasePool.query('select 1 from sites where id = $1', [siteId])).rowCount).toBe(0);
  });

  it('fails the run with the error when a stage throws', async () => {
    const { siteId } = await newSite();
    const outcome = await run(siteId, async () => {
      throw new Error('renderer crashed');
    });
    expect(outcome).toEqual({ status: 'failed', error_message: 'renderer crashed' });
  });
});
