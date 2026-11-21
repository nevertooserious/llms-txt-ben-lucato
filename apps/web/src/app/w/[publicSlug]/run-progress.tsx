import { isActiveRunStatus, type PipelineRunView } from '../../../shared/workspace-view';

const STAGES = ['Queued', 'Crawl', 'Generate', 'Done'] as const;

const TRIGGER_LABELS: Record<PipelineRunView['triggeredBy'], string> = {
  submission: 'First generation',
  monitor: 'Scheduled check',
  user_check_now: 'Check now',
};

/** Index into STAGES of the stage the run is at (or failed at). */
function stageIndex(run: PipelineRunView): number {
  if (run.status === 'succeeded' || run.status === 'unchanged') return STAGES.length;
  if (run.currentStage === 'generate') return 2;
  if (run.currentStage === 'crawl' || run.currentStage === 'extract') return 1;
  return 0;
}

function statusText(run: PipelineRunView): string {
  switch (run.status) {
    case 'queued':
      return 'Waiting for a worker';
    case 'running':
      return run.currentStage === 'generate' ? 'Writing the llms.txt' : 'Crawling the site';
    case 'succeeded':
      return 'Published a new version';
    case 'unchanged':
      return 'Checked: nothing changed';
    case 'failed':
      return 'The run failed';
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
  const current = stageIndex(run);
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
      <ol className="stages" aria-label="Run stages">
        {STAGES.map((stage, index) => {
          let className = 'stage';
          if (index < current) className += ' stage-done';
          else if (index === current) className += run.status === 'failed' ? ' stage-failed' : ' stage-current';
          return (
            <li key={stage} className={className} aria-current={index === current ? 'step' : undefined}>
              {stage}
            </li>
          );
        })}
      </ol>
      <dl className="counters">
        <Counter label="Discovered" value={run.pagesDiscoveredCount} />
        <Counter label="Fetched" value={run.pagesFetchedCount} />
        <Counter label="Changed" value={run.pagesChangedCount} />
        <Counter label="Failed" value={run.pagesFailedCount} />
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

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="counter">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
