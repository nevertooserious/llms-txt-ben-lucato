'use client';

import { useState } from 'react';
import type { WorkspaceView } from '../../../shared/workspace-view';
import { followLatestVersion, pinVersion, WorkspaceApiError } from './workspace-api';

interface VersionHistoryProps {
  view: WorkspaceView;
  accessToken: string;
  onChanged: () => Promise<void>;
}

/** Lists the workspace's versions and chooses which one the hosted URL serves. */
export function VersionHistory({ view, accessToken, onChanged }: VersionHistoryProps) {
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
      setErrorMessage(error instanceof WorkspaceApiError ? error.message : 'Something went wrong.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">
          <span className="index">05</span>Versions
        </h2>
        {view.isPublishedVersionPinned && (
          <div className="toolbar">
            <button
              type="button"
              className="button"
              disabled={isPending}
              onClick={() => perform(() => followLatestVersion(view.publicSlug, accessToken))}
            >
              Follow latest
            </button>
          </div>
        )}
      </header>
      <p className="hint">
        {view.isPublishedVersionPinned
          ? `Pinned to v${liveVersionNumber}. Checks keep recording new versions without making them live.`
          : 'The newest version goes live automatically. Pin one to keep serving it.'}
      </p>
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
                      onClick={() => perform(() => pinVersion(view.publicSlug, accessToken, version.versionNumber))}
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
