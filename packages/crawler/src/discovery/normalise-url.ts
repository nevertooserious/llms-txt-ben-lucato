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
 * The URL to request, as the site linked it: only the normalisation RFC 3986 calls safe
 * (case of scheme and host, default port, dot segments, percent-encoding case, which the
 * URL parser does), plus the fragment and tracking parameters dropped. Unlike
 * `normaliseUrl`, the trailing slash and query order are kept, because servers may treat
 * `/about` and `/about/` differently. Null for anything that is not http or https.
 */
export function cleanUrlForFetch(rawUrl: string, baseUrl?: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim(), baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  url.hash = '';
  const trackingNames = [...url.searchParams.keys()].filter((name) => TRACKING_PARAMETER_PATTERN.test(name));
  for (const name of trackingNames) url.searchParams.delete(name);
  if (url.search === '?') url.search = '';
  return url.href;
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

/**
 * Whether a URL is on another host of the same site: `docs.example.com` or
 * `example.com` for a site at `www.example.com`. The site's domain is its host without
 * a leading `www.`, so a site at `docs.example.com` is related only to hosts under
 * itself. No public suffix list is needed for that, at the cost of not relating
 * `docs.example.com` to `blog.example.com`. Same scheme and port as the root.
 */
export function isOnRelatedHost(url: string, rootUrl: string): boolean {
  let candidate: URL;
  let root: URL;
  try {
    candidate = new URL(url);
    root = new URL(rootUrl);
  } catch {
    return false;
  }
  if (candidate.host === root.host || candidate.protocol !== root.protocol || candidate.port !== root.port) return false;
  const siteDomain = root.hostname.replace(/^www\./, '');
  const isIpAddress = /^\d+(?:\.\d+){3}$/.test(siteDomain) || siteDomain.includes(':');
  if (isIpAddress || !siteDomain.includes('.')) return false;
  return candidate.hostname === siteDomain || candidate.hostname.endsWith(`.${siteDomain}`);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
