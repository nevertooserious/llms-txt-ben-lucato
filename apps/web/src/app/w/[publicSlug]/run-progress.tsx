import { isActiveRunStatus, type PipelineRunView } from '../../../shared/workspace-view';

const TRIGGER_LABELS: Record<PipelineRunView['triggeredBy'], string> = {
  submission: 'First generation',
  monitor: 'Scheduled check',
  user_check_now: 'Check now',
};

/** Where the site is in the process. Extraction happens during the crawl, so it is done once generating starts. */
function statusText(run: PipelineRunView): string {
  switch (run.status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return run.currentStage === 'generate' ? 'Extracted' : 'Crawling';
    case 'succeeded':
      return 'Generated';
    case 'unchanged':
      return 'Generated, no changes';
    case 'failed':
      return 'Failed';
  }
}

export function RunProgress({ run, hasPublishedVersion }: { run: PipelineRunView | null; hasPublishedVersion: boolean }) {
  if (run === null) {
    return (
      <>
        <header className="cell-header">
          <h2 className="cell-title">
            <span className="index">01</span>Latest run
          </h2>
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
        <h2 className="cell-title">
          <span className="index">01</span>Latest run
        </h2>
        <span className="label">
          {TRIGGER_LABELS[run.triggeredBy]} · {new Date(run.createdAt).toLocaleString()}
        </span>
      </header>
      <div className={`status-line ${statusClass}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        {statusText(run)}
      </div>
      {run.status === 'failed' && (
        <p className="notice notice-danger">
          {run.errorMessage ?? 'The run stopped without a reason.'}
          {hasPublishedVersion && ' The previously published file is still being served.'}
        </p>
      )}
    </>
  );
}
