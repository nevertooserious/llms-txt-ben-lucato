import type { CrawlResult } from '@llms-txt/contracts';
import type { CrawlSiteOptions } from '@llms-txt/crawler';
import type { DatabasePool, FinishedPipelineRunStatus } from '@llms-txt/db';
import type { GenerateLlmsTxtInput, LlmClient } from '@llms-txt/generator';
import type { Logger } from '@llms-txt/runtime';

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
  /** Assesses pages and writes the summary. */
  llmClient: LlmClient;
  now?: () => Date;
}

/** How a run ended, and whether that was recorded; it is not if the reaper failed the run first. */
export interface FinishedPipelineRun {
  status: FinishedPipelineRunStatus;
  isRecorded: boolean;
}
