'use client';

import { useState } from 'react';
import { isActiveRunStatus, type WorkspaceView } from '../../../shared/workspace-view';
import { checkNow, setMonitoring, WorkspaceApiError } from './workspace-api';

interface MonitoringPanelProps {
  view: WorkspaceView;
  accessToken: string;
  onChanged: () => Promise<void>;
}

export function MonitoringPanel({ view, accessToken, onChanged }: MonitoringPanelProps) {
  const [pendingAction, setPendingAction] = useState<'monitoring' | 'check' | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const isRunActive = view.latestRun !== null && isActiveRunStatus(view.latestRun.status);

  async function perform(action: 'monitoring' | 'check') {
    setPendingAction(action);
    setMessage(null);
    try {
      if (action === 'monitoring') {
        await setMonitoring(view.publicSlug, accessToken, !view.monitoring.isEnabled);
      } else {
        const outcome = await checkNow(view.publicSlug, accessToken);
        if (outcome.joinedActiveRun) setMessage({ text: 'A run was already in progress.', isError: false });
      }
      await onChanged();
    } catch (error) {
      const text = error instanceof WorkspaceApiError ? error.message : 'Something went wrong.';
      setMessage({ text, isError: true });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">
          <span className="index">02</span>Monitoring
        </h2>
      </header>
      <div className="field">
        <button
          type="button"
          role="switch"
          aria-checked={view.monitoring.isEnabled}
          className="switch"
          disabled={pendingAction !== null}
          onClick={() => perform('monitoring')}
        >
          <span>{view.monitoring.isEnabled ? 'Watching for changes' : 'Monitoring off'}</span>
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>
        {view.monitoring.isEnabled ? (
          <dl className="facts">
            <dt>Next check</dt>
            <dd>{formatDate(view.monitoring.nextCheckAt)}</dd>
            <dt>On until</dt>
            <dd>{formatDate(view.monitoring.enabledUntil)}</dd>
          </dl>
        ) : (
          <p className="hint">Re-crawls the site on a schedule and publishes a new version when it changes. Lasts 30 days.</p>
        )}
      </div>
      <div className="field">
        <button
          type="button"
          className="button"
          disabled={pendingAction !== null || isRunActive}
          onClick={() => perform('check')}
        >
          {pendingAction === 'check' ? 'Starting…' : isRunActive ? 'Run in progress' : '↻ Check now'}
        </button>
        {message && (
          <p className={message.isError ? 'form-error' : 'hint'} role="status">
            {message.text}
          </p>
        )}
      </div>
    </>
  );
}

function formatDate(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
