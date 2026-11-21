// The JSON the workspace screen polls: GET /api/workspaces/{publicSlug}. Shared by the
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
}

export interface WorkspaceView {
  publicSlug: string;
  rootUrl: string;
  siteTitle: string | null;
  /** Path of the hosted file, relative to the web app's origin. */
  hostedLlmsTxtPath: string;
  monitoring: {
    isEnabled: boolean;
    enabledUntil: string | null;
    nextCheckAt: string | null;
  };
  latestRun: PipelineRunView | null;
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
  versions: VersionSummaryView[];
}

export interface VersionSummaryView {
  versionNumber: number;
  listedPageCount: number;
  addedPageCount: number;
  removedPageCount: number;
  changedPageCount: number;
  createdAt: string;
}

export function isActiveRunStatus(status: PipelineRunStatus): boolean {
  return status === 'queued' || status === 'running';
}
