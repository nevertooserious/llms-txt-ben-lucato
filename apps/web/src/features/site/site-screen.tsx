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

/**
 * The site's view, polled: quickly while a run is queued or running, slowly otherwise.
 * `markDeleted` stops a poll already in flight from showing a deleted site again.
 */
function useSiteView(publicSlug: string) {
  const [view, setView] = useState<SiteView | null>(null);
  const [loadError, setLoadError] = useState<SiteApiError | null>(null);
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

  const markDeleted = useCallback(() => {
    isDeleted.current = true;
  }, []);

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

  return { view, loadError, refresh, markDeleted };
}

export function SiteScreen({ publicSlug }: { publicSlug: string }) {
  const { view, loadError, refresh, markDeleted } = useSiteView(publicSlug);
  const handleDeleted = useCallback(() => {
    markDeleted();
    window.location.assign('/');
  }, [markDeleted]);

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
      <SiteLedger view={view} onChanged={refresh} />
    </main>
  );
}

/** The site's cells: the latest run, monitoring, the file, its pages and its versions. */
function SiteLedger({ view, onChanged }: { view: SiteView; onChanged: () => Promise<void> }) {
  return (
    <div className="ledger">
      <section className="cell cell-half">
        <RunProgress run={view.latestRun} crawlPageBudget={view.crawlPageBudget} hasPublishedVersion={view.publishedVersion !== null} />
      </section>
      <section className="cell cell-half">
        <MonitoringPanel view={view} onChanged={onChanged} />
      </section>
      <section className="cell">
        <LlmsTxtResult view={view} />
      </section>
      <section className="cell">
        <PagesPanel view={view} onChanged={onChanged} />
      </section>
      {view.publishedVersion && (
        <section className="cell">
          <VersionComparison
            publicSlug={view.publicSlug}
            versions={view.versions}
            publishedVersionNumber={view.publishedVersion.versionNumber}
          />
        </section>
      )}
      <section className="cell">
        <VersionHistory view={view} onChanged={onChanged} />
      </section>
    </div>
  );
}
