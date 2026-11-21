// The monitor: schedules re-checks (the tick enqueues due checks and reaps runs that lost
// their worker), and decides what a re-check means for each stored page. A check runs
// through the same pipeline as a submission; the decisions here are pure functions that
// the worker calls.
export { runMonitorTick, type MonitorTickDependencies, type MonitorTickOutcome } from './monitor-tick';
export { NOT_FOUND_RESPONSES_BEFORE_REMOVAL, reconcilePage, sitemapDate, type PageReconciliation } from './reconcile-page';
export { evaluateSafetyGate, type SafetyGateVerdict } from './safety-gate';
export {
  assessSitemapLastModifiedTrust,
  observeSitemapLastModified,
  OBSERVATIONS_BEFORE_TRUST,
  type SitemapLastModifiedObservation,
} from './sitemap-trust';
