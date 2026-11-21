// The crawler owns all network I/O to target sites: robots.txt, sitemaps, page fetches
// and headless renders. Every outbound request goes through the SSRF guard.
export { crawlSite, type CrawlProgress, type CrawlResult, type CrawlSiteOptions } from './crawl/crawl-site';
export {
  HeadlessRenderer,
  type HeadlessRendererOptions,
  type RenderedPage,
  type RenderFailure,
  type RenderOptions,
  type RenderOutcome,
} from './network/headless-renderer';
export {
  DEFAULT_USER_AGENT,
  FETCH_FAILURE_REASONS,
  HttpFetcher,
  type FetchedResponse,
  type FetchFailure,
  type FetchFailureReason,
  type FetchOutcome,
  type FetchRequest,
  type HttpFetcherOptions,
} from './network/http-fetcher';
export {
  assertPublicAddress,
  BlockedAddressError,
  isBlockedAddress,
  publicInternetOnly,
  type HostnameResolver,
  type NetworkPolicy,
} from './network/ssrf-guard';
export { resolveSiteRootUrl, type ResolveSiteRootOptions } from './crawl/resolve-site-root';
