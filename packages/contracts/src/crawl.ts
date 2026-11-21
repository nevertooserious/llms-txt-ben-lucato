// What the crawler hands on: each fetched page as a RawPage, then one CrawlResult.

export const FETCH_METHODS = ['plain_http', 'headless_browser'] as const;
export type FetchMethod = (typeof FETCH_METHODS)[number];

export const DISCOVERY_SOURCES = ['sitemap', 'navigation', 'page_link', 'existing_llms_txt'] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

/** Crawler output: one fetched page, plus what discovery learned about it. */
export interface RawPage {
  /** The page's identity: normalised before fetching. */
  normalisedUrl: string;
  /** What was requested: the URL as the site linked it. Stored, so a re-check asks for the same form. */
  fetchUrl: string;
  /** Where the page ended up after redirects. */
  finalUrl: string;
  /** 304 when a conditional GET found the page unchanged; the body is then empty. */
  httpStatusCode: number;
  /** Response headers, lowercased names. */
  headers: Record<string, string>;
  /** The response body, or the rendered DOM when fetched with the headless browser. */
  html: string;
  fetchMethod: FetchMethod;
  crawlSignals: PageCrawlSignals;
  markdownVariantUrl: string | null;
  /** The page's sitemap <lastmod>, verbatim, or null when no sitemap lists it. */
  sitemapLastModified: string | null;
  /**
   * The page's links within the site, normalised, in page order, without repeats. Null
   * when this response had no page to read them from (a 304 or an error).
   */
  outboundLinkUrls: string[] | null;
}

/** Signals known when the page is fetched. */
export interface PageCrawlSignals {
  /** Link hops from the root URL. */
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  /**
   * A robots directive for this crawler (`<meta name="robots">` or X-Robots-Tag) says
   * `noindex`: the site asks that the page not be listed, so the generator leaves it out.
   */
  hasNoindexDirective: boolean;
}

/** Signals that depend on the whole crawl, so they are final only in the CrawlResult. */
export interface LinkSignals {
  isInSiteNavigation: boolean;
  inboundLinkCount: number;
  /**
   * The text of the homepage navigation link to the page ("Downloads"), or null when it
   * is not in the navigation or the link has no usable text. The generator uses it to
   * name a page whose own title does not, and to name sections.
   */
  navigationLabel: string | null;
  /**
   * Where the first navigation link to the page comes among the homepage's navigation
   * links, from 0; null when it is not in the navigation. The site's own order, which
   * the generator uses to order pages that score the same.
   */
  navigationPosition: number | null;
  /**
   * Where a walk of the site's current links first meets the page, from 0: nearest the
   * homepage first and links in the order they stand on a page, so this is the order of
   * the site's own menus and sidebars. Pages that answered 304 count through their stored
   * links. Null when nothing links it (a page found only through the sitemap). The
   * generator uses it to order pages that score the same.
   */
  firstLinkPosition: number | null;
}

/** Discovery signals the generator uses to score pages. */
export type CrawlSignals = PageCrawlSignals & LinkSignals;

/** A page stored from an earlier crawl, passed back to the crawler so it is re-checked. */
export interface KnownPage {
  normalisedUrl: string;
  /** The URL as the site last linked it; what a re-check requests. */
  fetchUrl: string;
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  /** Conditional GET validators from the last fetch. */
  httpEtag: string | null;
  httpLastModified: string | null;
  /** The sitemap <lastmod> stored from the last crawl, ISO 8601, or null. */
  sitemapLastModifiedAt: string | null;
  /** The links stored when the page was last read. Null means it must be read in full. */
  outboundLinkUrls: string[] | null;
  /** A removed page's links count only if it answers again. */
  isRemoved: boolean;
}

/**
 * robots.txt per RFC 9309. `unreachable` (5xx, timeout, network failure) means the site
 * was not crawled at all, and the run should fail with that reason.
 */
export type RobotsTxtStatus = 'parsed' | 'unavailable' | 'unreachable';

export type CrawlStopReason =
  | 'frontier_exhausted'
  | 'page_budget'
  | 'attempt_limit'
  | 'time_limit'
  | 'robots_txt_unreachable'
  /** robots.txt disallows the homepage, or where it redirects, and no other page was fetched. */
  | 'homepage_disallowed_by_robots';

/**
 * Why a fetch failed. Every one counts toward the safety gate. Responses that are not
 * failures of the site (a non-HTML type, a redirect into a disallowed path) are skipped
 * and are not listed.
 */
export const CRAWL_FAILURE_REASONS = [
  'invalid_url',
  'unsupported_scheme',
  'blocked_address',
  'too_many_redirects',
  'timeout',
  'response_too_large',
  'network_error',
  'render_error',
  /** A 5xx response. */
  'server_error',
  /** A 429 response, after the one retry Retry-After allows. */
  'rate_limited',
  /** A 401, 403 or 451 response: the site refused us, which says nothing about the page. */
  'blocked',
  /** A 200 that is a protection vendor's challenge page rather than the site's page. */
  'bot_challenge',
  'robots_txt_unreachable',
] as const;
export type CrawlFailureReason = (typeof CRAWL_FAILURE_REASONS)[number];

export interface CrawlFailure {
  url: string;
  reason: CrawlFailureReason;
  /** The response status for `server_error`, `rate_limited`, `blocked`, `bot_challenge` and a 5xx robots.txt; otherwise null. */
  httpStatusCode: number | null;
  message: string;
}

/** What the crawl as a whole found. The pages themselves were passed to `onPage` as they were fetched. */
export interface CrawlResult {
  robotsTxtStatus: RobotsTxtStatus;
  stopReason: CrawlStopReason;
  /** Pages passed to `onPage`, 304s and 404s included. */
  pagesFetchedCount: number;
  /** Of those, pages that answered 2xx or 304. With none, the crawl learned nothing about the site. */
  pagesWithContentCount: number;
  /**
   * Final link signals, keyed by normalised URL: every page passed to `onPage` and, when
   * the homepage was read, every known page, so all positions come from one walk.
   */
  linkSignals: Record<string, LinkSignals>;
  /** Known pages not requested because their trusted sitemap <lastmod> has not moved. */
  unchangedPerSitemapUrls: string[];
  /** Fetches that failed. They count toward the safety gate. */
  failedFetches: CrawlFailure[];
  /** For sites.requires_headless_rendering. */
  requiresHeadlessRendering: boolean;
  /** True when this crawl made the decision, so the caller can stamp when it was made. */
  decidedHeadlessRendering: boolean;
  /**
   * The site's own files for machines (see machineReadableResourceKindOf) that answered
   * this crawl, as the site links them. Null when the crawl could not tell, because it
   * ran out of time or one of them answered with an error: the caller keeps what it had.
   */
  machineReadableResourceUrls: string[] | null;
}
