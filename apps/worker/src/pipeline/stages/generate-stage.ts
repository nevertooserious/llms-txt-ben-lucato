import type { PipelineRunJob } from '@llms-txt/contracts';
import {
  loadGeneratorPages,
  loadNewestVersion,
  loadWorkspaceIdsForSite,
  recordPipelineRunProgress,
  saveSiteTitle,
  type SiteForRun,
} from '@llms-txt/db';
import { NOTHING_TO_LIST_REASON, selectPages, siteNameFrom, type GenerateLlmsTxtInput } from '@llms-txt/generator';
import type { PipelineStageDependencies } from '../pipeline-dependencies';
import { PipelineRunFailure } from '../pipeline-run-failure';
import type { CrawlStageResult } from './crawl-stage';
import { enrichPagesWithLlm } from './llm-enrichment';

/** Everything a render needs except a workspace's overrides: the same for every workspace of the site. */
export type SiteGenerationInput = Omit<GenerateLlmsTxtInput, 'overrides'>;

/**
 * Settles what every workspace's file is rendered from: the site's name, its pages with
 * their assessments, and the summary. Throws when the site has nothing to list and has
 * never published.
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

  // Judged for the site, before any workspace's exclusions: a user may empty their own
  // file. A site that has published before is let through: its pages went one by one, on
  // their own 404s, and the file should lose those links rather than keep them.
  if (selectPages(pages, []).length === 0) {
    const workspaceIds = await loadWorkspaceIdsForSite(databasePool, site.id);
    const newestVersions = await Promise.all(workspaceIds.map((workspaceId) => loadNewestVersion(databasePool, workspaceId)));
    if (newestVersions.every((version) => version === null)) throw new PipelineRunFailure(NOTHING_TO_LIST_REASON);
  }

  return {
    siteTitle,
    siteSummary,
    siteNotes,
    machineReadableResourceUrls: crawled.crawl.machineReadableResourceUrls ?? site.machineReadableResourceUrls,
    pages,
  };
}
