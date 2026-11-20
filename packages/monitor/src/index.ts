// The monitor has no pipeline of its own. It enqueues check runs for due sites, which
// go through the same crawl -> extract -> generate stages, and reaps stale runs.
export { enqueueDueMonitorChecks, reapStalePipelineRuns } from './monitor-tick';
