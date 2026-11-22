// The signed-in user's sites, as the home page lists them and GET /api/sites returns them.

export interface SiteListEntry {
  publicSlug: string;
  rootUrl: string;
  /** ISO 8601. */
  createdAt: string;
}

/** The path of a site's screen. */
export function sitePath(publicSlug: string): string {
  return `/w/${encodeURIComponent(publicSlug)}`;
}
