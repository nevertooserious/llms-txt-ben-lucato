import { isActiveRunStatus, runStatusLabel, type PipelineRunView } from '@/shared/site-view';

const RUN_TYPE_LABELS: Record<PipelineRunView['triggeredBy'], string> = {
  submission: 'First generation',
  monitor: 'Scheduled check',
  user_check_now: 'Manual check',
};

export function RunProgress({ run, hasPublishedVersion }: { run: PipelineRunView | null; hasPublishedVersion: boolean }) {
  if (run === null) {
    return (
      <>
        <header className="cell-header">
          <h2 className="cell-title">Latest run</h2>
        </header>
        <p className="empty-state">No runs yet.</p>
      </>
    );
  }

  const isActive = isActiveRunStatus(run.status);
  const statusClass = isActive ? 'status-active' : `status-${run.status}`;
  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">Latest run</h2>
        <div className={`status-line ${statusClass}`} role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {runStatusLabel(run)}
        </div>
      </header>
      <dl className="facts">
        <dt>Run type:</dt>
        <dd>{RUN_TYPE_LABELS[run.triggeredBy]}</dd>
        <dt>Started:</dt>
        <dd>{new Date(run.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        <dt>Pages:</dt>
        <dd>{pageCountsLabel(run)}</dd>
      </dl>
      {run.status === 'failed' && (
        <p className="notice notice-danger">
          {run.errorMessage ?? 'The run stopped without a reason.'}
          {hasPublishedVersion && ' The previously published file is still being served.'}
        </p>
      )}
    </>
  );
}

/** "12 of 40 fetched, 3 changed, 1 failed"; the counters rise while the run crawls. */
function pageCountsLabel(run: PipelineRunView): string {
  const parts = [`${run.pagesFetchedCount} of ${run.pagesDiscoveredCount} fetched`];
  if (run.pagesChangedCount > 0) parts.push(`${run.pagesChangedCount} changed`);
  if (run.pagesFailedCount > 0) parts.push(`${run.pagesFailedCount} failed`);
  return parts.join(', ');
}
