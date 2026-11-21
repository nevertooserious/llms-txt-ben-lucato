'use client';

import { useSyncExternalStore } from 'react';
import { loadSavedWorkspaces, secretLinkPath, type SavedWorkspace } from '../browser/saved-workspaces';

// Read once per mount; the list only changes when this browser submits a site, which
// navigates away. Cached so useSyncExternalStore sees a stable snapshot.
let cachedSnapshot: SavedWorkspace[] | null = null;
const readSnapshot = () => (cachedSnapshot ??= loadSavedWorkspaces());
const serverSnapshot: SavedWorkspace[] = [];
const subscribe = () => () => {
  cachedSnapshot = null;
};

export function RecentWorkspaces() {
  const workspaces = useSyncExternalStore(subscribe, readSnapshot, () => serverSnapshot);
  if (workspaces.length === 0) return null;
  return (
    <section className="recent">
      <span className="label">Your sites on this browser</span>
      <ol>
        {workspaces.map((workspace) => (
          <li key={workspace.publicSlug}>
            <a href={secretLinkPath(workspace.publicSlug, workspace.accessToken)}>
              <span className="recent-url">{workspace.rootUrl}</span>
              <span className="recent-date">{new Date(workspace.createdAt).toLocaleDateString()}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
