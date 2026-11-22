'use client';

import { useState } from 'react';
import { isActiveRunStatus, type SiteView } from '@/shared/site-view';
import { checkNow, SiteApiError } from '@/browser/site-api';

interface MonitoringPanelProps {
  view: SiteView;
  onChanged: () => Promise<void>;
}

export function MonitoringPanel({ view, onChanged }: MonitoringPanelProps) {
  const [isStartingCheck, setIsStartingCheck] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const isRunActive = view.latestRun !== null && isActiveRunStatus(view.latestRun.status);

  async function startCheck() {
    setIsStartingCheck(true);
    setMessage(null);
    try {
      const outcome = await checkNow(view.publicSlug);
      if (outcome.joinedActiveRun) setMessage({ text: 'A run was already in progress.', isError: false });
      await onChanged();
    } catch (error) {
      const text = error instanceof SiteApiError ? error.message : 'Something went wrong.';
      setMessage({ text, isError: true });
    } finally {
      setIsStartingCheck(false);
    }
  }

  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">Monitoring</h2>
        <button type="button" className="button" disabled={isStartingCheck || isRunActive} onClick={startCheck}>
          {isStartingCheck ? 'Starting…' : isRunActive ? 'Run in progress' : '↻ Check now'}
        </button>
      </header>
      <dl className="facts">
        <dt>Next check:</dt>
        <dd>{formatDate(view.monitoring.nextCheckAt)}</dd>
      </dl>
      {message && (
        <p className={message.isError ? 'form-error' : 'hint'} role="status">
          {message.text}
        </p>
      )}
    </>
  );
}

function formatDate(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
