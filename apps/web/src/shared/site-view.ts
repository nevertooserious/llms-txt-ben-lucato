// The JSON the site screen polls: GET /api/sites/{publicSlug}. Shared by the
// route handler and the browser; dates are ISO 8601 strings.

export type PipelineRunStatus = 'queued' | 'running' | 'succeeded' | 'unchanged' | 'failed';

export interface PipelineRunView {
  id: string;
  status: PipelineRunStatus;
  currentStage: 'crawl' | 'extract' | 'generate' | null;
  triggeredBy: 'submission' | 'monitor' | 'user_check_now';
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pagesDiscoveredCount: number;
  pagesFetchedCount: number;
  pagesChangedCount: number;
  pagesFailedCount: number;
}

/** GET /api/sites/{publicSlug}/runs/{runId}. */
export interface PipelineRunDetailView extends PipelineRunView {
  /** The version this run published; null while active, or if it changed nothing or failed. */
  versionNumber: number | null;
  /** Where to get that version's text, or null if there is none. */
  llmsTxtUrl: string | null;
}

export interface SiteView {
  publicSlug: string;
  rootUrl: string;
  siteTitle: string | null;
  /** False for the demo site, which the API refuses to delete. */
  canBeDeleted: boolean;
  /** Path of the hosted file, relative to the web app's origin. */
  hostedLlmsTxtPath: string;
  monitoring: {
    nextCheckAt: string | null;
  };
  latestRun: PipelineRunView | null;
  /** Most pages one run fetches. */
  crawlPageBudget: number;
  publishedVersion: {
    versionNumber: number;
    llmsTxtContent: string;
    listedPageCount: number;
    createdAt: string;
    validation: { isValid: boolean; problems: string[] };
  } | null;
  /** True when the user chose the published version, so new versions do not go live. */
  isPublishedVersionPinned: boolean;
  /** Newest first. */
  versions: LlmsTxtVersionSummaryView[];
}

/** One entry of GET /api/sites/{publicSlug}/versions, newest first. */
export interface LlmsTxtVersionSummaryView {
  versionNumber: number;
  listedPageCount: number;
  addedPageCount: number;
  removedPageCount: number;
  changedPageCount: number;
  createdBy: 'pipeline' | 'user_edit';
  createdAt: string;
}

const RUNNING_STAGE_LABELS: Record<NonNullable<PipelineRunView['currentStage']>, string> = {
  crawl: 'Crawling',
  extract: 'Extracting',
  generate: 'Generating',
};

export function isActiveRunStatus(status: PipelineRunStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** What the run is doing now, or how it ended. Pages are extracted as they are crawled, so the worker reports no 'extract' stage of its own. */
export function runStatusLabel(run: Pick<PipelineRunView, 'status' | 'currentStage'>): string {
  switch (run.status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return RUNNING_STAGE_LABELS[run.currentStage ?? 'crawl'];
    case 'succeeded':
      return 'Generated';
    case 'unchanged':
      return 'Generated, no changes';
    case 'failed':
      return 'Failed';
  }
}
