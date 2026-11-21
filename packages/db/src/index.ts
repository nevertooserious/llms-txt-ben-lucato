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
  loadPipelineRunDetail,
  lockRunningPipelineRun,
  reapStalePipelineRuns,
  recordPipelineRunHeartbeat,
  recordPipelineRunProgress,
  type FinishedPipelineRunStatus,
  type LatestPipelineRun,
  type PipelineRunDetail,
  type PipelineRunProgress,
  type PipelineRunStage,
  type PipelineRunStatus,
  type PipelineRunSummary,
  type StalePipelineRunThresholds,
} from './pipeline-runs';
export {
  claimDueMonitorChecks,
  countRecentSitesFromIp,
  createSite,
  deleteSite,
  loadPageOverrides,
  loadPublishedLlmsTxt,
  loadSiteForRun,
  loadSiteIdBySlug,
  loadSiteOverview,
  saveGeneratedSummary,
  saveResolvedRootUrl,
  saveSiteCrawlOutcome,
  saveSiteTitle,
  type NewSite,
  type SiteCrawlOutcome,
  type SiteForRun,
  type SiteOverview,
} from './sites';
export { enableSiteMonitoring, type MonitorSchedule } from './monitor-schedule';
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
  listLlmsTxtVersions,
  loadLlmsTxtVersionContent,
  loadLlmsTxtVersionFile,
  loadNewestVersion,
  pinPublishedVersion,
  publishLlmsTxtVersion,
  unpinPublishedVersion,
  type LlmsTxtVersionFile,
  type LlmsTxtVersionSummary,
  type NewLlmsTxtVersion,
  type NewestVersion,
} from './llms-txt-versions';
