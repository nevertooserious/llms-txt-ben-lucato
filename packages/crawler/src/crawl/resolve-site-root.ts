import { HttpFetcher } from '../network/http-fetcher';
import { cleanUrlForFetch, normaliseUrl } from '../discovery/normalise-url';
import { parseRobotsTxt, ROBOTS_TXT_MAX_PARSED_BYTES, robotsTxtUnavailable } from '../discovery/robots-rules';
import type { HostnameResolver, NetworkPolicy } from '../network/ssrf-guard';

export interface ResolveSiteRootOptions {
  /** The root URL as submitted. */
  rootUrl: string;
  /** Production leaves this out (public internet only). */
  networkPolicy?: NetworkPolicy;
  resolveHostname?: HostnameResolver;
  /** Least time between the two requests made here. */
  minRequestIntervalMs?: number;
}

/**
 * Where a site really lives: the root URL after following the homepage's redirect, so
 * `example.com` and `www.example.com` are one site (db/schema.sql, sites.root_url).
 *
 * Only a move to another origin changes the answer. A redirect within the origin
 * (`/` to `/en/`) stays inside the crawl's scope. When anything prevents an answer
 * (robots.txt unreachable or disallowing the homepage, a failed fetch, an error status)
 * the URL comes back unchanged, and the crawl reports the problem.
 */
export async function resolveSiteRootUrl(options: ResolveSiteRootOptions): Promise<string> {
  const rootUrl = normaliseUrl(options.rootUrl);
  const fetchUrl = cleanUrlForFetch(options.rootUrl);
  if (rootUrl === null || fetchUrl === null) return options.rootUrl;

  const fetcher = new HttpFetcher({ networkPolicy: options.networkPolicy, resolveHostname: options.resolveHostname });
  try {
    const robotsTxtUrl = new URL('/robots.txt', rootUrl).href;
    const robotsTxt = await fetcher.fetch({
      url: robotsTxtUrl,
      acceptedContentTypes: ['*/*'],
      maxResponseBytes: ROBOTS_TXT_MAX_PARSED_BYTES,
      truncateAtMaxBytes: true,
    });
    if (robotsTxt.kind === 'failed' || robotsTxt.httpStatusCode >= 500) return rootUrl;
    const isSuccess = robotsTxt.httpStatusCode >= 200 && robotsTxt.httpStatusCode < 300;
    const robots = isSuccess ? parseRobotsTxt(robotsTxtUrl, robotsTxt.body) : robotsTxtUnavailable;
    if (!robots.isAllowed(fetchUrl)) return rootUrl;

    await new Promise((resolve) => setTimeout(resolve, options.minRequestIntervalMs ?? 500));
    const rootHost = new URL(rootUrl).host;
    const homepage = await fetcher.fetch({
      url: fetchUrl,
      acceptedContentTypes: ['text/html', 'application/xhtml+xml'],
      // The rules read are this host's; a redirect within it obeys them, as in the crawl.
      isRedirectAllowed: (url) => new URL(url).host !== rootHost || robots.isAllowed(url),
    });
    if (homepage.kind === 'failed' || homepage.httpStatusCode < 200 || homepage.httpStatusCode >= 300) return rootUrl;

    const finalUrl = new URL(homepage.finalUrl);
    const root = new URL(rootUrl);
    if (finalUrl.origin === root.origin) return rootUrl;
    // A bare origin stays a bare origin, wherever its homepage landed; a path prefix follows the redirect.
    const movedRoot = root.pathname === '/' ? finalUrl.origin : `${finalUrl.origin}${finalUrl.pathname}`;
    return normaliseUrl(movedRoot) ?? rootUrl;
  } finally {
    await fetcher.close();
  }
}
