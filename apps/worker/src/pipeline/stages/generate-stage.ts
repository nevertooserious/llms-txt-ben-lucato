import type { PipelineRunJob } from '@llms-txt/contracts';
import { loadGeneratorPages, recordPipelineRunProgress, saveSiteTitle, type SiteForRun } from '@llms-txt/db';
import { siteNameFrom, type GenerateLlmsTxtInput } from '@llms-txt/generator';
import type { PipelineStageDependencies } from '../pipeline-dependencies';
import type { CrawlStageResult } from './crawl-stage';
import { enrichPagesWithLlm } from './llm-enrichment';

/** Everything a render needs except the user's overrides. */
export type SiteGenerationInput = Omit<GenerateLlmsTxtInput, 'overrides'>;

/**
 * Settles what the file is rendered from: the site's name, its pages with their
 * assessments, and the summary.
 */
export async function generateStage(
  job: PipelineRunJob,
  dependencies: PipelineStageDependencies,
  site: SiteForRun,
  crawled: CrawlStageResult,
): Promise<SiteGenerationInput> {
  const { databasePool, logger } = dependencies;
  await recordPipelineRunProgress(databasePool, job.pipelineRunId, {
    currentStage: 'generate',
    pagesChangedCount: crawled.pagesChangedCount,
  });
  const loadedPages = await loadGeneratorPages(databasePool, site.id);
  const siteTitle = siteNameFrom(crawled.siteTitle ?? new URL(site.rootUrl).host, loadedPages);
  if (crawled.siteTitle !== null && siteTitle !== crawled.siteTitle) {
    await saveSiteTitle(databasePool, site.id, siteTitle);
  }
  const { pages, siteSummary, siteNotes } = dependencies.llmClient
    ? await enrichPagesWithLlm({ databasePool, logger, llmClient: dependencies.llmClient, site, siteTitle, pages: loadedPages })
    : { pages: loadedPages, siteSummary: site.generatedSummary, siteNotes: site.generatedNotes };

  return {
    siteTitle,
    siteSummary,
    siteNotes,
    machineReadableResourceUrls: crawled.crawl.machineReadableResourceUrls ?? site.machineReadableResourceUrls,
    pages,
  };
}
