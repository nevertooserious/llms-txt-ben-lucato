import type { GeneratorPage, PageAssessment, StoredPageAssessment } from '@llms-txt/contracts';
import { saveGeneratedSummary, savePageAssessment, type DatabasePool, type SiteForRun } from '@llms-txt/db';
import {
  buildSiteSummaryInput,
  listingCandidates,
  LlmOutputRejectedError,
  pageAssessmentInputOf,
  pageAssessmentSourceHash,
  pagesToAssess,
  siteSummarySourceHash,
  type GeneratedSiteSummary,
  type LlmClient,
} from '@llms-txt/generator';
import type { Logger } from '@llms-txt/runtime';
import { PipelineRunFailure } from './pipeline-run-failure';

const MAX_CONCURRENT_PAGE_ASSESSMENTS = 5;

export interface LlmEnrichmentRequest {
  databasePool: DatabasePool;
  logger: Logger;
  llmClient: LlmClient;
  site: SiteForRun;
  siteTitle: string;
  pages: GeneratorPage[];
}

export interface LlmEnrichmentResult {
  pages: GeneratorPage[];
  siteSummary: string | null;
  siteNotes: string[];
}

/**
 * Assesses pages whose inputs changed, then rewrites the summary and its notes if their inputs changed.
 * Each result is saved as it arrives, so a failed run does not pay for it twice.
 *
 * A page with an older assessment keeps it when the LLM is unavailable. A new page
 * cannot be judged without one, so an outage then fails the run and the published file
 * stays. A page the model will not assess is left out of the file and tried next run.
 */
export async function enrichPagesWithLlm(request: LlmEnrichmentRequest): Promise<LlmEnrichmentResult> {
  const { databasePool, logger, llmClient, site, siteTitle, pages } = request;
  const pendingPages = pagesToAssess(pages);
  const newAssessments = new Map<string, StoredPageAssessment>();
  const blockingErrors: unknown[] = [];
  let nextPageIndex = 0;

  const assessNextPages = async (): Promise<void> => {
    while (blockingErrors.length === 0 && nextPageIndex < pendingPages.length) {
      const page = pendingPages[nextPageIndex++]!;
      const url = page.record.normalisedUrl;
      let assessment: PageAssessment;
      try {
        assessment = await llmClient.assessPage(pageAssessmentInputOf(page));
      } catch (error) {
        if (error instanceof LlmOutputRejectedError) logger.warn('page assessment rejected', { url, reason: error.message });
        else if (page.assessment !== null) logger.warn('page assessment failed; keeping the older one', { url, error });
        else blockingErrors.push(error);
        continue;
      }
      const stored = { ...assessment, sourceHash: pageAssessmentSourceHash(page) };
      await savePageAssessment(databasePool, site.id, url, stored);
      newAssessments.set(url, stored);
    }
  };
  const workerCount = Math.min(MAX_CONCURRENT_PAGE_ASSESSMENTS, pendingPages.length);
  await Promise.all(Array.from({ length: workerCount }, assessNextPages));
  if (blockingErrors.length > 0) {
    logger.warn('page assessment failed', { error: blockingErrors[0] });
    throw new PipelineRunFailure('The LLM could not be reached to assess new pages; the published file was left alone.');
  }

  const merged = pages.map((page) => {
    const assessment = newAssessments.get(page.record.normalisedUrl);
    return assessment === undefined ? page : { ...page, assessment };
  });
  const unassessedCandidates = new Set(
    listingCandidates(merged).filter((page) => page.assessment === null).map((page) => page.record.normalisedUrl),
  );
  const assessedPages = merged.filter((page) => !unassessedCandidates.has(page.record.normalisedUrl));

  const sourceHash = siteSummarySourceHash(siteTitle, assessedPages);
  const previous = { siteSummary: site.generatedSummary, siteNotes: site.generatedNotes };
  if (site.generatedSummary !== null && site.generatedSummarySourceHash === sourceHash) {
    return { pages: assessedPages, ...previous };
  }
  let written: GeneratedSiteSummary;
  try {
    written = await llmClient.writeSiteSummary(
      buildSiteSummaryInput(siteTitle, assessedPages, { summary: site.generatedSummary, notes: site.generatedNotes }),
    );
  } catch (error) {
    if (error instanceof LlmOutputRejectedError || site.generatedSummary !== null) {
      logger.warn('site summary not updated', { error });
      return { pages: assessedPages, ...previous };
    }
    logger.warn('site summary failed', { error });
    throw new PipelineRunFailure('The LLM could not be reached to write the site summary; the published file was left alone.');
  }
  await saveGeneratedSummary(databasePool, site.id, { text: written.summary, notes: written.notes, sourceHash });
  return { pages: assessedPages, siteSummary: written.summary, siteNotes: written.notes };
}
