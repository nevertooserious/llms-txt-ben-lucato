'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { accessTokenFor, forgetWorkspace, saveWorkspace } from '../../../browser/saved-workspaces';
import { isActiveRunStatus, type WorkspaceView } from '../../../shared/workspace-view';
import { LlmsTxtResult } from './llms-txt-result';
import { MonitoringPanel } from './monitoring-panel';
import { RunProgress } from './run-progress';
import { VersionHistory } from './version-history';
import { fetchWorkspaceView, WorkspaceApiError } from './workspace-api';

const ACTIVE_POLL_INTERVAL_MS = 1500;
const IDLE_POLL_INTERVAL_MS = 30_000;

type TokenState = { kind: 'reading' } | { kind: 'missing' } | { kind: 'found'; accessToken: string };

export function WorkspaceScreen({ publicSlug }: { publicSlug: string }) {
  const [token, setToken] = useState<TokenState>({ kind: 'reading' });
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [loadError, setLoadError] = useState<WorkspaceApiError | null>(null);
  // Set on delete, so a poll already in flight cannot save the workspace back.
  const isDeleted = useRef(false);

  // The token lives in the URL fragment or localStorage, so it can only be read here.
  useEffect(() => {
    const accessToken = accessTokenFor(publicSlug);
    setToken(accessToken === null ? { kind: 'missing' } : { kind: 'found', accessToken });
  }, [publicSlug]);

  const accessToken = token.kind === 'found' ? token.accessToken : null;

  const refresh = useCallback(async () => {
    if (accessToken === null) return;
    try {
      const loaded = await fetchWorkspaceView(publicSlug, accessToken);
      if (isDeleted.current) return;
      setView(loaded);
      setLoadError(null);
      saveWorkspace({ publicSlug, accessToken, rootUrl: loaded.rootUrl, createdAt: new Date().toISOString() });
    } catch (error) {
      if (isDeleted.current) return;
      setLoadError(error instanceof WorkspaceApiError ? error : new WorkspaceApiError('Could not reach the server.', 0));
    }
  }, [publicSlug, accessToken]);

  const handleDeleted = useCallback(() => {
    isDeleted.current = true;
    forgetWorkspace(publicSlug);
    window.location.assign('/');
  }, [publicSlug]);

  // Poll quickly while a run is queued or running, slowly otherwise.
  const isRunActive = view?.latestRun ? isActiveRunStatus(view.latestRun.status) : false;
  useEffect(() => {
    if (accessToken === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isCancelled = false;
    const tick = async () => {
      await refresh();
      if (!isCancelled) timer = setTimeout(tick, isRunActive ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, isRunActive, refresh]);

  if (token.kind === 'missing' || loadError?.status === 401 || loadError?.status === 404) {
    return (
      <main className="site-heading">
        <span className="label">Workspace</span>
        <h1>{loadError?.status === 404 ? 'No workspace here.' : 'This link is missing its token.'}</h1>
        <p className="hero-lede">
          {loadError?.status === 404
            ? 'Check the address, or generate a new llms.txt from the home page.'
            : 'Open the full secret link you were given when you submitted the site. It ends in #token=….'}
        </p>
        <a className="button" href="/">
          ← Home
        </a>
      </main>
    );
  }

  if (view === null || accessToken === null) {
    return (
      <main className="site-heading">
        <span className="label">Workspace</span>
        <h1>Loading…</h1>
        {loadError && <p className="notice notice-danger">{loadError.message}</p>}
      </main>
    );
  }

  const siteHost = new URL(view.rootUrl).host;
  return (
    <main>
      <section className="site-heading">
        <span className="label">Workspace · {publicSlug}</span>
        <h1>{view.siteTitle ?? siteHost}</h1>
        <a href={view.rootUrl} target="_blank" rel="noreferrer noopener">
          {view.rootUrl} ↗
        </a>
        {loadError && <p className="notice notice-danger">{loadError.message} Retrying…</p>}
      </section>
      <div className="ledger">
        <section className="cell cell-wide">
          <RunProgress run={view.latestRun} hasPublishedVersion={view.publishedVersion !== null} />
        </section>
        <section className="cell cell-narrow">
          <MonitoringPanel view={view} accessToken={accessToken} onChanged={refresh} onDeleted={handleDeleted} />
        </section>
        <section className="cell">
          <LlmsTxtResult view={view} siteHost={siteHost} />
        </section>
        <section className="cell">
          <VersionHistory view={view} accessToken={accessToken} onChanged={refresh} />
        </section>
      </div>
    </main>
  );
}
