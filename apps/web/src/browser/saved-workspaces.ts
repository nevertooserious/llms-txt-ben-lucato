// The secret links this browser has created, kept in localStorage so the home page can
// list them and a workspace opened without its link's token can still be edited. The
// token travels in the URL fragment (/w/{slug}#token=...), which browsers never send to
// the server, so it stays out of request logs.

export interface SavedWorkspace {
  publicSlug: string;
  accessToken: string;
  rootUrl: string;
  createdAt: string;
}

const STORAGE_KEY = 'llms-txt-generator.workspaces';

export function loadSavedWorkspaces(): SavedWorkspace[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SavedWorkspace[]) : [];
  } catch {
    return [];
  }
}

export function saveWorkspace(workspace: SavedWorkspace): void {
  const others = loadSavedWorkspaces().filter((saved) => saved.publicSlug !== workspace.publicSlug);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([workspace, ...others].slice(0, 20)));
  } catch {
    // Storage full or blocked: the secret link still works on its own.
  }
}

/** The path of a workspace's secret link. */
export function secretLinkPath(publicSlug: string, accessToken: string): string {
  return `/w/${encodeURIComponent(publicSlug)}#token=${encodeURIComponent(accessToken)}`;
}

/** The token in the current URL's fragment, else the one saved for this workspace. */
export function accessTokenFor(publicSlug: string): string | null {
  const fromFragment = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromFragment) return fromFragment;
  return loadSavedWorkspaces().find((saved) => saved.publicSlug === publicSlug)?.accessToken ?? null;
}
