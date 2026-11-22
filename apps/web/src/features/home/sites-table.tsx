'use client';

import { useEffect, useState } from 'react';
import { sitePath, type SiteListEntry } from '@/shared/site-list';
import { isActiveRunStatus, runStatusLabel, type SiteView } from '@/shared/site-view';
import { fetchSiteView, SiteApiError } from '@/browser/site-api';

const ACTIVE_POLL_INTERVAL_MS = 3000;

type SiteRowState = { kind: 'loaded'; view: SiteView } | { kind: 'unavailable' };

function isRunActive(row: SiteRowState | undefined): boolean {
  return row?.kind === 'loaded' && row.view.latestRun !== null && isActiveRunStatus(row.view.latestRun.status);
}

/** Loads every site once, then keeps polling only those with a run in progress. */
function useSiteRows(sites: SiteListEntry[]): Map<string, SiteRowState> {
  const [rows, setRows] = useState<Map<string, SiteRowState>>(new Map());

  useEffect(() => {
    const latestRows = new Map<string, SiteRowState>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isCancelled = false;

    const loadRow = async (site: SiteListEntry) => {
      try {
        const view = await fetchSiteView(site.publicSlug);
        latestRows.set(site.publicSlug, { kind: 'loaded', view });
      } catch (error) {
        const isGone = error instanceof SiteApiError && error.status === 404;
        // A brief failure keeps what the row already shows.
        const previous = latestRows.get(site.publicSlug);
        latestRows.set(site.publicSlug, isGone || !previous ? { kind: 'unavailable' } : previous);
      }
    };

    const tick = async () => {
      const due = sites.filter((site) => {
        const row = latestRows.get(site.publicSlug);
        return row === undefined || isRunActive(row);
      });
      await Promise.all(due.map(loadRow));
      if (isCancelled) return;
      setRows(new Map(latestRows));
      if (sites.some((site) => isRunActive(latestRows.get(site.publicSlug)))) {
        timer = setTimeout(tick, ACTIVE_POLL_INTERVAL_MS);
      }
    };
    void tick();

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [sites]);

  return rows;
}

function SiteStatus({ row }: { row: SiteRowState | undefined }) {
  if (row === undefined) return <span className="sites-muted">Loading…</span>;
  if (row.kind === 'unavailable') return <span className="sites-muted">Unavailable</span>;
  const run = row.view.latestRun;
  if (run === null) return <span className="sites-muted">No runs yet</span>;
  const statusClass = isActiveRunStatus(run.status) ? 'status-active' : `status-${run.status}`;
  return (
    <span className={`sites-status ${statusClass}`}>
      <span className="status-dot" aria-hidden="true" />
      {runStatusLabel(run)}
    </span>
  );
}

export function SitesTable({ sites }: { sites: SiteListEntry[] }) {
  const rows = useSiteRows(sites);
  return (
    <section className="sites">
      <table className="sites-table">
        <caption className="visually-hidden">Your sites</caption>
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Status</th>
            <th scope="col">Live</th>
            <th scope="col" className="sites-optional">
              Pages
            </th>
            <th scope="col" className="sites-optional">
              Last run
            </th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => {
            const row = rows.get(site.publicSlug);
            const view = row?.kind === 'loaded' ? row.view : null;
            const lastRun = view?.latestRun;
            return (
              <tr key={site.publicSlug}>
                <th scope="row">
                  <a href={sitePath(site.publicSlug)}>{site.rootUrl}</a>
                </th>
                <td>
                  <SiteStatus row={row} />
                </td>
                <td>{view?.publishedVersion ? `v${view.publishedVersion.versionNumber}` : '—'}</td>
                <td className="sites-optional">{view?.publishedVersion?.listedPageCount ?? '—'}</td>
                <td className="sites-optional">
                  {lastRun ? new Date(lastRun.finishedAt ?? lastRun.createdAt).toLocaleString() : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
