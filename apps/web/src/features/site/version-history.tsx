'use client';

import { useState } from 'react';
import type { SiteView } from '@/shared/site-view';
import { followLatestVersion, pinVersion, SiteApiError } from '@/browser/site-api';

interface VersionHistoryProps {
  view: SiteView;
  onChanged: () => Promise<void>;
}

/** Lists the site's versions and chooses which one the hosted URL serves. */
export function VersionHistory({ view, onChanged }: VersionHistoryProps) {
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const liveVersionNumber = view.publishedVersion?.versionNumber ?? null;

  async function perform(action: () => Promise<unknown>) {
    setIsPending(true);
    setErrorMessage(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      setErrorMessage(error instanceof SiteApiError ? error.message : 'Something went wrong.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">Versions</h2>
        {view.isPublishedVersionPinned && (
          <div className="toolbar">
            <button
              type="button"
              className="button"
              disabled={isPending}
              onClick={() => perform(() => followLatestVersion(view.publicSlug))}
            >
              Follow latest
            </button>
          </div>
        )}
      </header>
      {errorMessage && (
        <p className="form-error" role="status">
          {errorMessage}
        </p>
      )}
      {view.versions.length === 0 ? (
        <p className="empty-state">No versions yet.</p>
      ) : (
        <ol className="version-list">
          {view.versions.map((version) => {
            const isLive = version.versionNumber === liveVersionNumber;
            return (
              <li key={version.versionNumber} className="version-row">
                <strong>v{version.versionNumber}</strong>
                <span>{new Date(version.createdAt).toLocaleString()}</span>
                <span>{version.listedPageCount} pages</span>
                <span>
                  +{version.addedPageCount} −{version.removedPageCount} ~{version.changedPageCount}
                </span>
                <span className="version-actions">
                  {isLive && <span className="badge badge-valid">{view.isPublishedVersionPinned ? 'Pinned' : 'Live'}</span>}
                  {!(isLive && view.isPublishedVersionPinned) && (
                    <button
                      type="button"
                      className="button"
                      disabled={isPending}
                      onClick={() => perform(() => pinVersion(view.publicSlug, version.versionNumber))}
                    >
                      {isLive ? `Pin v${version.versionNumber}` : `Make v${version.versionNumber} live`}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
