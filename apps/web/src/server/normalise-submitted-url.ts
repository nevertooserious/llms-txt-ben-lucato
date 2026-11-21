/**
 * A submitted URL as a sites.root_url: http or https, lowercase host, no credentials,
 * query, fragment, default port or trailing slash; a path is kept, since it scopes the
 * crawl. A bare host gets https. Null when it is not a usable web address. Whether the
 * address is public is the crawler's SSRF guard's call, made when it connects.
 */
export function normaliseSubmittedUrl(submitted: string): string | null {
  const trimmed = submitted.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}
