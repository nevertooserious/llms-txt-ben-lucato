import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { generateLlmsTxt, type PageChanges } from '@llms-txt/generator';
import { crawlSite, HeadlessRenderer, resolveSiteRootUrl } from '@llms-txt/crawler';
import {
  createDatabasePool,
  createSite,
  loadPublishedLlmsTxt,
  replaceExcludedUrlPrefixes,
  startPipelineRun,
  withTransaction,
  type DatabasePool,
} from '@llms-txt/db';
import { createLogger } from '@llms-txt/runtime';
import { readWorkerConfig } from '../../apps/worker/src/config/worker-config';
import { startWorkerJobs } from '../../apps/worker/src/jobs/worker-jobs';
import { createStubLlmClient } from '../../apps/worker/src/llm/stub-llm-client';
import { startFixtureSite, type FixtureSite } from './fixture-site-server';
import { allowLoopbackPorts } from './local-network-policy';

// The whole pipeline as it runs in production: a run is submitted through pg-boss, the
// real worker claims it, crawls a fixture site through real HTTP and Chromium, extracts,
// stores, generates and publishes. Tests then read what the web app would serve.
//
// Needs DATABASE_URL pointing at a database with db/schema.sql applied. In CI the e2e job
// provides one; locally, tests that need it are skipped with a message when it is unset.
//
// The queue lives in its own pg-boss schema. monitor.test.ts runs another worker on the
// same database at the same time; on a shared queue each worker could take the other's
// jobs, and its network policy would refuse the other file's fixture sites.
const QUEUE_SCHEMA = 'pgboss_site_flavours';

export const databaseUrl = process.env.DATABASE_URL ?? null;
if (databaseUrl === null && process.env.CI) {
  throw new Error('DATABASE_URL must point at a database with db/schema.sql applied for the pipeline tests');
}

export type FinishedStatus = 'succeeded' | 'unchanged' | 'failed';

export interface PipelineRunRow {
  status: FinishedStatus;
  errorMessage: string | null;
  pagesFetchedCount: number;
  pagesFailedCount: number;
  pagesChangedCount: number;
}

export interface SubmittedSite {
  site: FixtureSite;
  siteId: string;
  publicSlug: string;
  /** The first run, finished. */
  firstRun: PipelineRunRow;
}

export interface StoredPageRow {
  http_status_code: number | null;
  fetch_method: string | null;
  extracted_title: string | null;
  page_type: string | null;
  discovered_via: string | null;
  removed_at: Date | null;
  markdown_variant_url: string | null;
}

export interface VersionRow {
  version_number: number;
  listed_page_count: number;
  page_changes: PageChanges;
}

export class PipelineHarness {
  private readonly startedSites: FixtureSite[] = [];

  private constructor(
    readonly databasePool: DatabasePool,
    private readonly queue: PgBoss,
    private readonly headlessRenderer: HeadlessRenderer,
    private readonly allowedPorts: Set<number>,
  ) {}

  static async start(options: { crawlPageBudget?: number } = {}): Promise<PipelineHarness> {
    const allowedPorts = new Set<number>();
    const networkPolicy = allowLoopbackPorts(allowedPorts);
    const headlessRenderer = new HeadlessRenderer({ networkPolicy, timeoutMs: 15_000 });
    const config = {
      ...readWorkerConfig({ DATABASE_URL: databaseUrl! , LLM_CLIENT: 'stub' }),
      crawlPageBudget: options.crawlPageBudget ?? 30,
      pipelineRunConcurrency: 4,
    };
    const databasePool = createDatabasePool(databaseUrl!);
    // No cron: this file starts every run itself.
    const queue = new PgBoss({ connectionString: databaseUrl!, schema: QUEUE_SCHEMA, schedule: false });
    await queue.start();
    await startWorkerJobs({
      queue,
      databasePool,
      logger: createLogger({ level: 'warn', fields: { process: 'e2e-worker' } }),
      config,
      crawl: (options) => crawlSite({ ...options, networkPolicy, headlessRenderer, minRequestIntervalMs: 0 }),
      resolveRootUrl: (rootUrl) => resolveSiteRootUrl({ rootUrl, networkPolicy, minRequestIntervalMs: 0 }),
      renderLlmsTxt: generateLlmsTxt,
      llmClient: createStubLlmClient(),
      pollingIntervalSeconds: 0.5,
    });
    return new PipelineHarness(databasePool, queue, headlessRenderer, allowedPorts);
  }

  async stop(): Promise<void> {
    await this.queue.stop({ graceful: true });
    await this.headlessRenderer.close();
    await this.databasePool.end();
    await Promise.all(this.startedSites.map((site) => site.close()));
  }

  /** Serves a fixture site on a new port and opens that port to the worker's crawls. */
  async startSite(siteName: string): Promise<FixtureSite> {
    const site = await startFixtureSite(siteName);
    this.startedSites.push(site);
    this.allowedPorts.add(site.port);
    return site;
  }

  /** What a URL submission does: a new site and a run, in one transaction. Waits for the run. */
  async submit(site: FixtureSite, rootPath = ''): Promise<SubmittedSite> {
    const publicSlug = randomUUID();
    const { siteId, pipelineRunId } = await withTransaction(this.databasePool, async (transaction) => {
      const siteId = await createSite(transaction, { rootUrl: `${site.origin}${rootPath}`, publicSlug });
      const run = await startPipelineRun(transaction, this.queue, { siteId, triggeredBy: 'submission' });
      if (run.kind !== 'started') throw new Error('the site already had an active run');
      return { siteId, pipelineRunId: run.pipelineRunId };
    });
    return { site, siteId, publicSlug, firstRun: await this.waitForRun(pipelineRunId) };
  }

  /** A user pressing "check now": another run through the same pipeline. Waits for it. */
  async checkNow(submitted: SubmittedSite): Promise<PipelineRunRow> {
    const run = await withTransaction(this.databasePool, (transaction) =>
      startPipelineRun(transaction, this.queue, { siteId: submitted.siteId, triggeredBy: 'user_check_now' }),
    );
    if (run.kind !== 'started') throw new Error('the site already had an active run');
    return this.waitForRun(run.pipelineRunId);
  }

  async waitForRun(pipelineRunId: string, timeoutMs = 50_000): Promise<PipelineRunRow> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await this.databasePool.query<{
        status: string;
        error_message: string | null;
        pages_fetched_count: number;
        pages_failed_count: number;
        pages_changed_count: number;
      }>(
        `select status, error_message, pages_fetched_count, pages_failed_count, pages_changed_count
           from pipeline_runs where id = $1`,
        [pipelineRunId],
      );
      const row = result.rows[0]!;
      if (row.status === 'succeeded' || row.status === 'unchanged' || row.status === 'failed') {
        return {
          status: row.status,
          errorMessage: row.error_message,
          pagesFetchedCount: row.pages_fetched_count,
          pagesFailedCount: row.pages_failed_count,
          pagesChangedCount: row.pages_changed_count,
        };
      }
      if (Date.now() > deadline) throw new Error(`run ${pipelineRunId} still ${row.status} after ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** What /w/{slug}/llms.txt serves. */
  publishedLlmsTxt(submitted: SubmittedSite): Promise<string | null> {
    return loadPublishedLlmsTxt(this.databasePool, submitted.publicSlug);
  }

  async versions(submitted: SubmittedSite): Promise<VersionRow[]> {
    const result = await this.databasePool.query<VersionRow>(
      `select version_number, listed_page_count, page_changes
         from llms_txt_versions where site_id = $1 order by version_number`,
      [submitted.siteId],
    );
    return result.rows;
  }

  async storedPage(submitted: SubmittedSite, path: string): Promise<StoredPageRow | undefined> {
    const result = await this.databasePool.query<StoredPageRow>(
      `select http_status_code, fetch_method, extracted_title, page_type, discovered_via,
              removed_at, markdown_variant_url
         from pages where site_id = $1 and normalised_url = $2`,
      [submitted.siteId, urlOf(submitted.site, path)],
    );
    return result.rows[0];
  }

  async storedPagePaths(submitted: SubmittedSite): Promise<string[]> {
    const result = await this.databasePool.query<{ normalised_url: string }>(
      'select normalised_url from pages where site_id = $1 order by normalised_url',
      [submitted.siteId],
    );
    return result.rows.map((row) => row.normalised_url.slice(submitted.site.origin.length) || '/');
  }

  async requiresHeadlessRendering(submitted: SubmittedSite): Promise<boolean | null> {
    const result = await this.databasePool.query<{ requires_headless_rendering: boolean | null }>(
      'select requires_headless_rendering from sites where id = $1',
      [submitted.siteId],
    );
    return result.rows[0]!.requires_headless_rendering;
  }

  /** A user edit, as the frontend will store it. */
  async setOverride(
    submitted: SubmittedSite,
    path: string,
    override: { descriptionOverride?: string | null; isExcluded?: boolean },
  ): Promise<void> {
    await this.databasePool.query(
      `insert into page_overrides (page_id, description_override, is_excluded)
       select id, $3, $4 from pages where site_id = $1 and normalised_url = $2
       on conflict (page_id) do update
         set description_override = excluded.description_override, is_excluded = excluded.is_excluded`,
      [
        submitted.siteId,
        urlOf(submitted.site, path),
        override.descriptionOverride ?? null,
        override.isExcluded ?? false,
      ],
    );
  }

  /** The paths the user ignores, as the frontend stores them: every page at or under one is left out. */
  async setExcludedPaths(submitted: SubmittedSite, paths: string[]): Promise<void> {
    await withTransaction(this.databasePool, (transaction) =>
      replaceExcludedUrlPrefixes(
        transaction,
        submitted.siteId,
        paths.map((path) => urlOf(submitted.site, path)),
      ),
    );
  }
}

export function urlOf(site: FixtureSite, path: string): string {
  return path === '/' ? site.origin : `${site.origin}${path}`;
}
