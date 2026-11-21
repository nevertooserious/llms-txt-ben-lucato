'use client';

import { useState } from 'react';
import { isActiveRunStatus, type WorkspaceView } from '../../../shared/workspace-view';
import { checkNow, deleteWorkspace, WorkspaceApiError } from './workspace-api';

interface MonitoringPanelProps {
  view: WorkspaceView;
  accessToken: string;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}

export function MonitoringPanel({ view, accessToken, onChanged, onDeleted }: MonitoringPanelProps) {
  const [pendingAction, setPendingAction] = useState<'check' | 'delete' | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const isRunActive = view.latestRun !== null && isActiveRunStatus(view.latestRun.status);

  async function perform(action: 'check' | 'delete') {
    setPendingAction(action);
    setMessage(null);
    try {
      if (action === 'delete') {
        await deleteWorkspace(view.publicSlug, accessToken);
        onDeleted();
        return;
      }
      const outcome = await checkNow(view.publicSlug, accessToken);
      if (outcome.joinedActiveRun) setMessage({ text: 'A run was already in progress.', isError: false });
      await onChanged();
    } catch (error) {
      if (action === 'delete' && error instanceof WorkspaceApiError && error.status === 404) {
        onDeleted();
        return;
      }
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
        {view.monitoring.isEnabled ? (
          <>
            <p className="monitoring-state">Watching for changes</p>
            <dl className="facts">
              <dt>Next check</dt>
              <dd>{formatDate(view.monitoring.nextCheckAt)}</dd>
              <dt>On until</dt>
              <dd>{formatDate(view.monitoring.enabledUntil)}</dd>
            </dl>
            <p className="hint">Check now renews monitoring for 30 days.</p>
          </>
        ) : (
          <>
            <p className="monitoring-state">Monitoring has lapsed</p>
            <p className="hint">Check now to resume it for 30 days.</p>
          </>
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
      <div className="field">
        {isConfirmingDelete ? (
          <>
            <p className="hint">This permanently removes your llms.txt, its hosted URL and its version history.</p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-danger"
                disabled={pendingAction !== null}
                onClick={() => perform('delete')}
              >
                {pendingAction === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                type="button"
                className="button"
                disabled={pendingAction !== null}
                onClick={() => setIsConfirmingDelete(false)}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="button button-danger"
            disabled={pendingAction !== null}
            onClick={() => setIsConfirmingDelete(true)}
          >
            Delete site
          </button>
        )}
      </div>
    </>
  );
}

function formatDate(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
