// Database access. db/schema.sql is the source of truth for the schema; every query is
// hand-written SQL in this package, grouped by the table it writes, and the rest of the
// code calls these functions. Only this package may import `pg` (eslint.config.js).
export { createDatabasePool, type DatabasePool } from './connection/database-pool';
export { withTransaction, type Queryable, type Transaction } from './connection/transaction';
export {
  createPipelineQueues,
  PIPELINE_RUN_QUEUE_OPTIONS,
  startPipelineRun,
  type PipelineRunQueue,
  type StartPipelineRunOutcome,
  type StartPipelineRunRequest,
} from './queue/pipeline-run-queue';
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
} from './repositories/pipeline-runs';
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
} from './repositories/sites';
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
} from './repositories/workspaces';
export {
  enableWorkspaceMonitoring,
  type MonitorSchedule,
  type WorkspaceMonitoringChange,
} from './repositories/monitor-schedule';
export {
  loadGeneratorPages,
  loadStoredPages,
  saveCrawledPage,
  saveExtractedPage,
  saveLinkSignals,
  savePageAssessment,
  type CrawledPageWrite,
  type StoredPage,
} from './repositories/pages';
export {
  listLlmsTxtVersions,
  loadLlmsTxtVersionContent,
  loadNewestVersion,
  pinPublishedVersion,
  publishLlmsTxtVersion,
  unpinPublishedVersion,
  type LlmsTxtVersionSummary,
  type NewLlmsTxtVersion,
  type NewestVersion,
} from './repositories/llms-txt-versions';
