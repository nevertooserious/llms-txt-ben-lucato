// Database access. db/schema.sql is the source of truth for the schema; every query is
// hand-written SQL in this package, grouped by the table it writes, and the rest of the
// code calls these functions. Only this package may import `pg` (eslint.config.js).
export { createDatabasePool, type DatabasePool } from './database-pool';
export { withTransaction, type Queryable, type Transaction } from './transaction';
export {
  createPipelineQueues,
  PIPELINE_RUN_QUEUE_OPTIONS,
  startPipelineRun,
  type PipelineRunQueue,
  type StartPipelineRunOutcome,
  type StartPipelineRunRequest,
} from './pipeline-run-queue';
export {
  claimPipelineRun,
  finishPipelineRun,
  loadLatestPipelineRun,
  loadLatestPipelineRunSummary,
  lockRunningPipelineRun,
  reapStalePipelineRuns,
  recordPipelineRunHeartbeat,
  recordPipelineRunProgress,
  type FinishedPipelineRunStatus,
  type LatestPipelineRun,
  type PipelineRunProgress,
  type PipelineRunStage,
  type PipelineRunStatus,
  type PipelineRunSummary,
  type StalePipelineRunThresholds,
} from './pipeline-runs';
export {
  adoptResolvedSiteRoot,
  claimDueMonitorChecks,
  findOrCreateSite,
  loadSiteForRun,
  lockSiteRow,
  saveGeneratedSummary,
  saveSiteCrawlOutcome,
  saveSiteTitle,
  type SiteCrawlOutcome,
  type SiteForRun,
  type SiteRootAdoption,
} from './sites';
export {
  countRecentWorkspacesFromIp,
  createWorkspace,
  deleteWorkspace,
  loadPublishedLlmsTxt,
  loadWorkspaceAccess,
  loadWorkspaceIdsForSite,
  loadWorkspaceOverrides,
  loadWorkspaceOverview,
  type NewWorkspace,
  type WorkspaceAccess,
  type WorkspaceOverview,
} from './workspaces';
export {
  enableWorkspaceMonitoring,
  type MonitorSchedule,
  type WorkspaceMonitoringChange,
} from './monitor-schedule';
export {
  loadGeneratorPages,
  loadStoredPages,
  saveCrawledPage,
  saveExtractedPage,
  saveLinkSignals,
  savePageAssessment,
  type CrawledPageWrite,
  type StoredPage,
} from './pages';
export {
  loadNewestVersion,
  loadVersionHistory,
  pinPublishedVersion,
  publishLlmsTxtVersion,
  unpinPublishedVersion,
  type NewLlmsTxtVersion,
  type NewestVersion,
  type VersionSummary,
} from './llms-txt-versions';
