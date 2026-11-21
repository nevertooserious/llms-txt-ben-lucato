import type { CrawlResult, KnownPage, PipelineRunJob, RawPage } from '@llms-txt/contracts';
import type { CrawlSiteOptions } from '@llms-txt/crawler';
import {
  adoptResolvedSiteRoot,
  loadGeneratorPages,
  loadPublishedVersion,
  loadSiteForRun,
  loadStoredPages,
  loadWorkspaceIdsForSite,
  loadWorkspaceOverrides,
  lockRunningPipelineRun,
  publishLlmsTxtVersion,
  recordPipelineRunProgress,
  saveCrawledPage,
  saveExtractedPage,
  saveLinkSignals,
  saveSiteCrawlOutcome,
  saveSiteTitle,
  withTransaction,
  type DatabasePool,
  type FinishedPipelineRunStatus,
  type StoredPage,
} from '@llms-txt/db';
import { extractPage } from '@llms-txt/extractor';
import { decidePublication, type GenerateLlmsTxtInput, type LlmClient } from '@llms-txt/generator';
import {
  assessSitemapLastModifiedTrust,
  evaluateSafetyGate,
  observeSitemapLastModified,
  reconcilePage,
  type PageReconciliation,
  type SitemapLastModifiedObservation,
} from '@llms-txt/monitor';
import type { Logger } from '@llms-txt/runtime';
import { enrichPagesWithLlm } from './llm-enrichment-stage';
import { PipelineRunFailure } from './pipeline-run-failure';

export { PipelineRunFailure };

// The stages of one run. This is the imperative shell: it loads state, hands it to the
// stages and the pure decisions (reconcilePage, evaluateSafetyGate, decidePublication,
// ...), and writes what they return. The rules themselves live in those functions, where
// they are tested without a database.

export interface PipelineSettings {
  crawlPageBudget: number;
  /** Above this share of failed fetches the run fails and nothing is published. */
  maxFailedFetchShare: number;
}

/** What the stages need. The crawler and the renderer are passed in, so tests can stand in for them. */
export interface PipelineStageDependencies {
  databasePool: DatabasePool;
  logger: Logger;
  settings: PipelineSettings;
  /** crawlSite, with the worker's shared headless renderer. */
  crawl: (options: CrawlSiteOptions) => Promise<CrawlResult>;
  /** resolveSiteRootUrl: the root URL after the homepage's redirect. */
  resolveRootUrl: (rootUrl: string) => Promise<string>;
  /** generateLlmsTxt. */
  renderLlmsTxt: (input: GenerateLlmsTxtInput) => string;
  /** Assesses pages and writes the summary. Without one, the generator's heuristics are used. */
  llmClient?: LlmClient | null;
  now?: () => Date;
}

const PROGRESS_WRITE_INTERVAL_MS = 2_000;

export async function runPipelineStages(
  job: PipelineRunJob,
  dependencies: PipelineStageDependencies,
): Promise<FinishedPipelineRunStatus> {
  const { databasePool, logger, settings } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const { pipelineRunId } = job;

  // --- load --------------------------------------------------------------------------
  let site = await loadSiteForRun(databasePool, job.siteId);
  let storedPageList = await loadStoredPages(databasePool, site.id);

  // A site's first crawl settles where it really lives, so example.com and
  // www.example.com are one row. A site with pages keeps its root: see section 10, "Redirects".
  if (storedPageList.length === 0) {
    const resolvedRootUrl = await dependencies.resolveRootUrl(site.rootUrl);
    if (resolvedRootUrl !== site.rootUrl) {
      const adoption = await withTransaction(databasePool, (transaction) =>
        adoptResolvedSiteRoot(transaction, { siteId: site.id, pipelineRunId, resolvedRootUrl }),
      );
      logger.info('site root resolved', { resolvedRootUrl, adoption: adoption.kind });
      if (adoption.kind === 'merged_into_active_run') return 'unchanged';
      site = await loadSiteForRun(databasePool, adoption.siteId);
      storedPageList = await loadStoredPages(databasePool, site.id);
    }
  }
  const storedPages = new Map(storedPageList.map((page) => [page.normalisedUrl, page]));
  let siteTitle = site.siteTitle;

  // --- crawl, extracting each page as it arrives ---------------------------------------
  await recordPipelineRunProgress(databasePool, pipelineRunId, { currentStage: 'crawl' });
  const changedUrls = new Set<string>();
  const deferredNotFound: Array<Extract<PageReconciliation, { kind: 'not_found' }>> = [];
  const trustObservations: SitemapLastModifiedObservation[] = [];
  let pagesDiscoveredCount = 0;
  let lastProgressWriteAt = 0;

  const handlePage = async (page: RawPage): Promise<void> => {
    const stored = storedPages.get(page.normalisedUrl);
    const outcome = reconcilePage(stored, page, now());
    if (outcome.kind === 'ignored') return;
    if (outcome.kind === 'not_found') {
      deferredNotFound.push(outcome);
      return;
    }
    await saveCrawledPage(databasePool, site.id, pipelineRunId, outcome.write);
    if (outcome.kind === 'fetched') {
      const extracted = await extractAndSave(page, stored);
      if (extracted && page.crawlSignals.crawlDepth === 0 && extracted.title !== null && extracted.title !== siteTitle) {
        siteTitle = extracted.title;
        await saveSiteTitle(databasePool, site.id, extracted.title);
      }
    }
  };

  const extractAndSave = async (page: RawPage, stored: StoredPage | undefined) => {
    let record;
    try {
      record = extractPage({
        html: page.html,
        normalisedUrl: page.normalisedUrl,
        finalUrl: page.finalUrl,
        isHomepage: page.crawlSignals.crawlDepth === 0,
      });
    } catch (error) {
      // One page the extractor cannot read keeps its old record; the run goes on.
      logger.warn('extraction failed', { url: page.normalisedUrl, error });
      return null;
    }
    await saveExtractedPage(databasePool, site.id, record);
    if (stored?.listingFieldsHash !== record.listingFieldsHash || stored.removedAt !== null) {
      changedUrls.add(page.normalisedUrl);
    }
    const observation = observeSitemapLastModified(stored, page, record.contentDigest);
    if (observation !== null) trustObservations.push(observation);
    return record;
  };

  const crawl = await dependencies.crawl({
    rootUrl: site.rootUrl,
    pageBudget: settings.crawlPageBudget,
    requiresHeadlessRendering: site.requiresHeadlessRendering,
    knownPages: [...storedPages.values()].map(knownPageFrom),
    sitemapLastModifiedIsTrusted: site.sitemapLastModifiedIsTrusted,
    onProgress: (progress) => (pagesDiscoveredCount = progress.pagesDiscovered),
    onPage: async (page) => {
      await handlePage(page);
      if (Date.now() - lastProgressWriteAt >= PROGRESS_WRITE_INTERVAL_MS) {
        lastProgressWriteAt = Date.now();
        await recordPipelineRunProgress(databasePool, pipelineRunId, {
          pagesDiscoveredCount,
          pagesChangedCount: changedUrls.size,
        });
      }
    },
  });

  await saveLinkSignals(databasePool, site.id, crawl.linkSignals);
  await recordPipelineRunProgress(databasePool, pipelineRunId, {
    pagesDiscoveredCount,
    pagesFetchedCount: crawl.pagesFetchedCount,
    pagesFailedCount: crawl.failedFetches.length,
  });
  logger.info('crawl finished', {
    stopReason: crawl.stopReason,
    pagesFetchedCount: crawl.pagesFetchedCount,
    failedFetchCount: crawl.failedFetches.length,
  });

  // --- safety gate: a failed run removes nothing and publishes nothing -------------------
  const verdict = evaluateSafetyGate(crawl, settings.maxFailedFetchShare);
  if (!verdict.passed) throw new PipelineRunFailure(verdict.reason);

  for (const notFound of deferredNotFound) {
    await saveCrawledPage(databasePool, site.id, pipelineRunId, notFound.write);
    if (notFound.isNewlyRemoved) changedUrls.add(notFound.write.normalisedUrl);
  }
  await saveSiteCrawlOutcome(databasePool, site.id, {
    requiresHeadlessRendering: crawl.requiresHeadlessRendering,
    decidedHeadlessRendering: crawl.decidedHeadlessRendering,
    sitemapLastModifiedIsTrusted: assessSitemapLastModifiedTrust(site.sitemapLastModifiedIsTrusted, trustObservations),
  });

  // --- generate and publish, per workspace ---------------------------------------------
  await recordPipelineRunProgress(databasePool, pipelineRunId, {
    currentStage: 'generate',
    pagesChangedCount: changedUrls.size,
  });
  const renderedSiteTitle = siteTitle ?? new URL(site.rootUrl).host;
  const loadedPages = await loadGeneratorPages(databasePool, site.id);
  const { pages: generatorPages, siteSummary } = dependencies.llmClient
    ? await enrichPagesWithLlm({
        databasePool,
        logger,
        llmClient: dependencies.llmClient,
        site,
        siteTitle: renderedSiteTitle,
        pages: loadedPages,
      })
    : { pages: loadedPages, siteSummary: site.generatedSummary };
  let publishedCount = 0;
  for (const workspaceId of await loadWorkspaceIdsForSite(databasePool, site.id)) {
    const rendered = dependencies.renderLlmsTxt({
      siteTitle: renderedSiteTitle,
      siteSummary,
      pages: generatorPages,
      overrides: await loadWorkspaceOverrides(databasePool, workspaceId),
    });
    const published = await loadPublishedVersion(databasePool, workspaceId);
    const decision = decidePublication(published?.llmsTxtContent ?? null, rendered);
    if (decision.kind === 'unchanged') continue;

    await withTransaction(databasePool, async (transaction) => {
      // A run the reaper has failed must not publish, even if it got this far.
      if (!(await lockRunningPipelineRun(transaction, pipelineRunId))) {
        throw new PipelineRunFailure('The run was failed for missing heartbeats before it could publish.');
      }
      const version = await publishLlmsTxtVersion(transaction, {
        workspaceId,
        pipelineRunId,
        createdBy: 'pipeline',
        llmsTxtContent: decision.llmsTxtContent,
        llmsTxtContentHash: decision.llmsTxtContentHash,
        listedPageCount: decision.listedPageCount,
        pageChanges: decision.pageChanges,
      });
      logger.info('published', { workspaceId, versionNumber: version.versionNumber, ...decision.pageChanges });
    });
    publishedCount += 1;
  }
  return publishedCount > 0 ? 'succeeded' : 'unchanged';
}

function knownPageFrom(stored: StoredPage): KnownPage {
  return {
    normalisedUrl: stored.normalisedUrl,
    fetchUrl: stored.fetchUrl,
    crawlDepth: stored.crawlDepth,
    discoveredVia: stored.discoveredVia,
    httpEtag: stored.httpEtag,
    httpLastModified: stored.httpLastModified,
    sitemapLastModifiedAt: stored.sitemapLastModifiedAt,
  };
}
