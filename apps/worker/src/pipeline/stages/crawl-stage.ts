import type { CrawlResult, KnownPage, PageRecord, PipelineRunJob, RawPage } from '@llms-txt/contracts';
import {
  recordPipelineRunProgress,
  saveCrawledPage,
  saveExtractedPage,
  saveLinkSignals,
  saveSiteCrawlOutcome,
  saveSiteTitle,
  type SiteForRun,
  type StoredPage,
} from '@llms-txt/db';
import { extractPage } from '@llms-txt/extractor';
import { reconcilePage, type PageReconciliation } from '../decisions/reconcile-page';
import { evaluateSafetyGate } from '../decisions/safety-gate';
import {
  assessSitemapLastModifiedTrust,
  observeSitemapLastModified,
  type SitemapLastModifiedObservation,
} from '../decisions/sitemap-trust';
import type { PipelineStageDependencies } from '../pipeline-dependencies';
import { PipelineRunFailure } from '../pipeline-run-failure';

export interface CrawlStageResult {
  crawl: CrawlResult;
  /** The homepage's title as this crawl read it, else the stored one. */
  siteTitle: string | null;
  /** Pages whose llms.txt entry may have changed: new, edited, restored or newly removed. */
  pagesChangedCount: number;
}

const PROGRESS_WRITE_INTERVAL_MS = 2_000;

/**
 * Crawls the site, extracting and storing each page as it arrives, then puts the crawl
 * through the safety gate. A crawl that fails the gate throws: it removes nothing and
 * publishes nothing.
 */
export async function crawlStage(
  job: PipelineRunJob,
  dependencies: PipelineStageDependencies,
  site: SiteForRun,
  storedPageList: readonly StoredPage[],
): Promise<CrawlStageResult> {
  const { databasePool, logger, settings } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const { pipelineRunId } = job;
  const storedPages = new Map(storedPageList.map((page) => [page.normalisedUrl, page]));
  let siteTitle = site.siteTitle;

  await recordPipelineRunProgress(databasePool, pipelineRunId, { currentStage: 'crawl' });
  const changedUrls = new Set<string>();
  const deferredNotFound: Extract<PageReconciliation, { kind: 'not_found' }>[] = [];
  const trustObservations: SitemapLastModifiedObservation[] = [];
  let pagesDiscoveredCount = 0;
  let pagesHandledCount = 0;
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

  const extractAndSave = async (page: RawPage, stored: StoredPage | undefined): Promise<PageRecord | null> => {
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
    knownMachineReadableResourceUrls: site.machineReadableResourceUrls,
    onProgress: (progress) => (pagesDiscoveredCount = progress.pagesDiscovered),
    onPage: async (page) => {
      await handlePage(page);
      pagesHandledCount += 1;
      if (Date.now() - lastProgressWriteAt >= PROGRESS_WRITE_INTERVAL_MS) {
        lastProgressWriteAt = Date.now();
        await recordPipelineRunProgress(databasePool, pipelineRunId, {
          pagesDiscoveredCount,
          // A running count for the site screen; the crawl's own count replaces it at the end.
          pagesFetchedCount: pagesHandledCount,
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

  // The safety gate: a failed run removes nothing and publishes nothing.
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
    machineReadableResourceUrls: crawl.machineReadableResourceUrls,
  });

  return { crawl, siteTitle, pagesChangedCount: changedUrls.size };
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
    outboundLinkUrls: stored.outboundLinkUrls,
    isRemoved: stored.removedAt !== null,
  };
}
