import { isActiveRunStatus, runStatusLabel, type PipelineRunView } from '../../../shared/site-view';

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
