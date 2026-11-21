// The sites this browser has created, kept in localStorage so the home page can list them.

export interface SavedSite {
  publicSlug: string;
  rootUrl: string;
  createdAt: string;
}

const STORAGE_KEY = 'llms-txt-generator.sites';

// TODO blucato
export function loadSavedSites(): SavedSite[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SavedSite[]) : [];
  } catch {
    return [];
  }
}

export function saveSite(site: SavedSite): void {
  const saved = loadSavedSites();
  // The site screen saves on every poll, so a known site keeps its place and date.
  const existing = saved.find((entry) => entry.publicSlug === site.publicSlug);
  const updated = existing
    ? saved.map((entry) => (entry === existing ? { ...site, createdAt: existing.createdAt } : entry))
    : [site, ...saved].slice(0, 20);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage full or blocked: the site's link still works on its own.
  }
}

export function forgetSite(publicSlug: string): void {
  const remaining = loadSavedSites().filter((saved) => saved.publicSlug !== publicSlug);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Storage blocked: there is nothing saved to remove.
  }
}

/** The path of a site's screen. */
export function sitePath(publicSlug: string): string {
  return `/w/${encodeURIComponent(publicSlug)}`;
}
