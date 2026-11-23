'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isActiveRunStatus, type SiteView } from '@/shared/site-view';
import { DeleteSiteControl } from './delete-site-control';
import { LlmsTxtResult } from './llms-txt-result';
import { MonitoringPanel } from './monitoring-panel';
import { PagesPanel } from './pages-panel';
import { RunProgress } from './run-progress';
import { VersionComparison } from './version-comparison';
import { VersionHistory } from './version-history';
import { fetchSiteView, SiteApiError } from '@/browser/site-api';

const ACTIVE_POLL_INTERVAL_MS = 1500;
const IDLE_POLL_INTERVAL_MS = 30_000;

export function SiteScreen({ publicSlug }: { publicSlug: string }) {
  const [view, setView] = useState<SiteView | null>(null);
  const [loadError, setLoadError] = useState<SiteApiError | null>(null);
  // Set on delete, so a poll already in flight cannot show the site again.
  const isDeleted = useRef(false);
  // A poll can overlap the refresh after a change (a pin, a save). Only the newest
  // request's answer is shown, so a poll sent before the change cannot undo it on screen.
  const latestRequestNumber = useRef(0);

  const refresh = useCallback(async () => {
    latestRequestNumber.current += 1;
    const requestNumber = latestRequestNumber.current;
    const isOutdated = () => isDeleted.current || requestNumber !== latestRequestNumber.current;
    try {
      const loaded = await fetchSiteView(publicSlug);
      if (isOutdated()) return;
      setView(loaded);
      setLoadError(null);
    } catch (error) {
      if (isOutdated()) return;
      setLoadError(error instanceof SiteApiError ? error : new SiteApiError('Could not reach the server.', 0));
    }
  }, [publicSlug]);

  const handleDeleted = useCallback(() => {
    isDeleted.current = true;
    window.location.assign('/');
  }, [publicSlug]);

  // Poll quickly while a run is queued or running, slowly otherwise.
  const isRunActive = view?.latestRun ? isActiveRunStatus(view.latestRun.status) : false;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isCancelled = false;
    const tick = async () => {
      await refresh();
      if (!isCancelled) timer = setTimeout(() => void tick(), isRunActive ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isRunActive, refresh]);

  if (loadError?.status === 404) {
    return (
      <main className="site-heading">
        <span className="label">Site</span>
        <h1>No site here.</h1>
        <p className="hero-lede">Check the address, or generate a new llms.txt from the home page.</p>
        <a className="button" href="/">
          ← Home
        </a>
      </main>
    );
  }

  if (view === null) {
    return (
      <main className="site-heading">
        <span className="label">Site</span>
        <h1>Loading…</h1>
        {loadError && <p className="notice notice-danger">{loadError.message}</p>}
      </main>
    );
  }

  return (
    <main>
      <section className="site-heading">
        <div className="site-heading-row">
          <div>
            <a className="back-link" href="/">
              ← All sites
            </a>
            <h1 className="site-url-heading">
              <a href={view.rootUrl} target="_blank" rel="noreferrer noopener">
                {view.rootUrl} ↗
              </a>
            </h1>
          </div>
          {view.canBeDeleted && <DeleteSiteControl publicSlug={publicSlug} onDeleted={handleDeleted} />}
        </div>
        {loadError && <p className="notice notice-danger">{loadError.message} Retrying…</p>}
      </section>
      <div className="ledger">
        <section className="cell cell-half">
          <RunProgress run={view.latestRun} crawlPageBudget={view.crawlPageBudget} hasPublishedVersion={view.publishedVersion !== null} />
        </section>
        <section className="cell cell-half">
          <MonitoringPanel view={view} onChanged={refresh} />
        </section>
        <section className="cell">
          <LlmsTxtResult view={view} />
        </section>
        <section className="cell">
          <PagesPanel view={view} onChanged={refresh} />
        </section>
        {view.publishedVersion && (
          <section className="cell">
            <VersionComparison
              publicSlug={publicSlug}
              versions={view.versions}
              publishedVersionNumber={view.publishedVersion.versionNumber}
            />
          </section>
        )}
        <section className="cell">
          <VersionHistory view={view} onChanged={refresh} />
        </section>
      </div>
    </main>
  );
}
