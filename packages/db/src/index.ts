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
  lockRunningPipelineRun,
  reapStalePipelineRuns,
  recordPipelineRunHeartbeat,
  recordPipelineRunProgress,
  type FinishedPipelineRunStatus,
  type PipelineRunProgress,
  type PipelineRunStage,
  type StalePipelineRunThresholds,
} from './pipeline-runs';
export { claimDueMonitorChecks, findOrCreateSite } from './sites';
export { countRecentWorkspacesFromIp, createWorkspace, loadPublishedLlmsTxt, type NewWorkspace } from './workspaces';
