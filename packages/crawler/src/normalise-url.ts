// A page's identity is its normalised URL (docs/design/README.md, section 3): the URL
// after cleanup that needs no fetch.

// Parameters that track a visit rather than select content.
const TRACKING_PARAMETER_PATTERN = /^(utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|igshid)$/i;

/**
 * Lowercase scheme and host, default port dropped, fragment and tracking parameters
 * removed, query sorted, trailing slash stripped (except the bare root). Returns null
 * for anything that is not an absolute http or https URL.
 */
export function normaliseUrl(rawUrl: string, baseUrl?: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim(), baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;

  url.hash = '';
  const keptParameters = [...url.searchParams].filter(([name]) => !TRACKING_PARAMETER_PATTERN.test(name));
  keptParameters.sort(([nameA, valueA], [nameB, valueB]) =>
    nameA === nameB ? compare(valueA, valueB) : compare(nameA, nameB),
  );
  url.search = new URLSearchParams(keptParameters).toString();

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '');
  // URL already lowercases the scheme and host and drops default ports.
  const normalised = url.href;
  // A bare origin keeps no trailing slash, to match how sites.root_url is stored.
  return url.pathname === '/' && url.search === '' ? normalised.slice(0, -1) : normalised;
}

/**
 * Whether a URL is inside a site's crawl scope: same scheme, host and port as the root,
 * and a path at or under the root's path prefix, on a segment boundary
 * (`/docs` covers `/docs/a`, not `/docs-old`).
 */
export function isInScope(url: string, rootUrl: string): boolean {
  let candidate: URL;
  let root: URL;
  try {
    candidate = new URL(url);
    root = new URL(rootUrl);
  } catch {
    return false;
  }
  if (candidate.origin !== root.origin) return false;
  const rootPath = root.pathname.replace(/\/+$/, '');
  if (rootPath === '') return true;
  return candidate.pathname === rootPath || candidate.pathname.startsWith(`${rootPath}/`);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
