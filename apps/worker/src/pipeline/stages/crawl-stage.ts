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
  const { pipelineRunId } = job;
  const storedPages = new Map(storedPageList.map((page) => [page.normalisedUrl, page]));
  const pageStore = new CrawledPageStore(dependencies, site, pipelineRunId, storedPages);

  await recordPipelineRunProgress(databasePool, pipelineRunId, { currentStage: 'crawl' });
  let pagesDiscoveredCount = 0;
  let pagesHandledCount = 0;
  let lastProgressWriteAt = 0;

  const crawl = await dependencies.crawl({
    rootUrl: site.rootUrl,
    pageBudget: settings.crawlPageBudget,
    readsExistingLlmsTxt: settings.readsExistingLlmsTxt,
    requiresHeadlessRendering: site.requiresHeadlessRendering,
    knownPages: [...storedPages.values()].map(knownPageFrom),
    sitemapLastModifiedIsTrusted: site.sitemapLastModifiedIsTrusted,
    knownMachineReadableResourceUrls: site.machineReadableResourceUrls,
    onProgress: (progress) => (pagesDiscoveredCount = progress.pagesDiscovered),
    onPage: async (page) => {
      await pageStore.handlePage(page);
      pagesHandledCount += 1;
      if (Date.now() - lastProgressWriteAt >= PROGRESS_WRITE_INTERVAL_MS) {
        lastProgressWriteAt = Date.now();
        await recordPipelineRunProgress(databasePool, pipelineRunId, {
          pagesDiscoveredCount,
          // A running count for the site screen; the crawl's own count replaces it at the end.
          pagesFetchedCount: pagesHandledCount,
          pagesChangedCount: pageStore.changedUrls.size,
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

  await pageStore.saveDeferredRemovals();
  await saveSiteCrawlOutcome(databasePool, site.id, {
    requiresHeadlessRendering: crawl.requiresHeadlessRendering,
    decidedHeadlessRendering: crawl.decidedHeadlessRendering,
    sitemapLastModifiedIsTrusted: assessSitemapLastModifiedTrust(site.sitemapLastModifiedIsTrusted, pageStore.trustObservations),
    machineReadableResourceUrls: crawl.machineReadableResourceUrls,
  });

  return { crawl, siteTitle: pageStore.siteTitle, pagesChangedCount: pageStore.changedUrls.size };
}

/**
 * Stores each page as the crawl hands it over, and keeps what the stage needs once the
 * crawl is done. A page that answered 404 or 410 is held back until the crawl has passed
 * the safety gate, so a failed run removes nothing.
 */
class CrawledPageStore {
  /** The homepage's title as this crawl read it, else the stored one. */
  siteTitle: string | null;
  readonly changedUrls = new Set<string>();
  readonly trustObservations: SitemapLastModifiedObservation[] = [];
  private readonly deferredNotFound: Extract<PageReconciliation, { kind: 'not_found' }>[] = [];
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: PipelineStageDependencies,
    private readonly site: SiteForRun,
    private readonly pipelineRunId: string,
    private readonly storedPages: ReadonlyMap<string, StoredPage>,
  ) {
    this.siteTitle = site.siteTitle;
    this.now = dependencies.now ?? (() => new Date());
  }

  async handlePage(page: RawPage): Promise<void> {
    const { databasePool } = this.dependencies;
    const stored = this.storedPages.get(page.normalisedUrl);
    const outcome = reconcilePage(stored, page, this.now());
    if (outcome.kind === 'ignored') return;
    if (outcome.kind === 'not_found') {
      this.deferredNotFound.push(outcome);
      return;
    }
    await saveCrawledPage(databasePool, this.site.id, this.pipelineRunId, outcome.write);
    if (outcome.kind !== 'fetched') return;
    const title = (await this.extractAndSave(page, stored))?.title ?? null;
    if (page.crawlSignals.crawlDepth === 0 && title !== null && title !== this.siteTitle) {
      this.siteTitle = title;
      await saveSiteTitle(databasePool, this.site.id, title);
    }
  }

  async saveDeferredRemovals(): Promise<void> {
    for (const notFound of this.deferredNotFound) {
      await saveCrawledPage(this.dependencies.databasePool, this.site.id, this.pipelineRunId, notFound.write);
      if (notFound.isNewlyRemoved) this.changedUrls.add(notFound.write.normalisedUrl);
    }
  }

  private async extractAndSave(page: RawPage, stored: StoredPage | undefined): Promise<PageRecord | null> {
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
      this.dependencies.logger.warn('extraction failed', { url: page.normalisedUrl, error });
      return null;
    }
    await saveExtractedPage(this.dependencies.databasePool, this.site.id, record);
    if (stored?.listingFieldsHash !== record.listingFieldsHash || stored.removedAt !== null) {
      this.changedUrls.add(page.normalisedUrl);
    }
    const observation = observeSitemapLastModified(stored, page, record.contentDigest);
    if (observation !== null) this.trustObservations.push(observation);
    return record;
  }
}

function knownPageFrom(stored: StoredPage): KnownPage {
  return {
    normalisedUrl: stored.normalisedUrl,
    fetchUrl: stored.fetchUrl,
    crawlDepth: stored.crawlDepth,
    discoveredVia: stored.discoveredVia,
    languageCode: stored.languageCode,
    httpEtag: stored.httpEtag,
    httpLastModified: stored.httpLastModified,
    sitemapLastModifiedAt: stored.sitemapLastModifiedAt,
    outboundLinkUrls: stored.outboundLinkUrls,
    isRemoved: stored.removedAt !== null,
  };
}
