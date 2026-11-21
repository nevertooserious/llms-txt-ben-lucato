// The typed hand-offs between pipeline stages (docs/design/diagrams/pipeline-contracts.svg):
//
//   crawler:   site URL       -> RawPage, one at a time, then a CrawlResult
//   extractor: RawPage        -> PageRecord
//   generator: GeneratorPage[] -> llms.txt text
//
// Enum values mirror the check constraints in db/schema.sql; a test in @llms-txt/db
// keeps the two in step.

export const PAGE_TYPES = [
  'home',
  'docs',
  'api',
  'guide',
  'blog',
  'product',
  'pricing',
  'about',
  'legal',
  'other',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const FETCH_METHODS = ['plain_http', 'headless_browser'] as const;
export type FetchMethod = (typeof FETCH_METHODS)[number];

export const DISCOVERY_SOURCES = ['sitemap', 'navigation', 'page_link', 'existing_llms_txt'] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export const PIPELINE_TRIGGERS = ['submission', 'monitor', 'user_check_now'] as const;
export type PipelineTrigger = (typeof PIPELINE_TRIGGERS)[number];

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
  | 'robots_txt_unreachable';

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
  'robots_txt_unreachable',
] as const;
export type CrawlFailureReason = (typeof CRAWL_FAILURE_REASONS)[number];

export interface CrawlFailure {
  url: string;
  reason: CrawlFailureReason;
  /** The response status for `server_error`, `rate_limited` and a 5xx robots.txt; otherwise null. */
  httpStatusCode: number | null;
  message: string;
}

/** What the crawl as a whole found. The pages themselves were passed to `onPage` as they were fetched. */
export interface CrawlResult {
  robotsTxtStatus: RobotsTxtStatus;
  stopReason: CrawlStopReason;
  /** Pages passed to `onPage`, 304s and 404s included. */
  pagesFetchedCount: number;
  /** Final link signals for every page passed to `onPage`, keyed by normalised URL. */
  linkSignals: Record<string, LinkSignals>;
  /** Known pages not requested because their trusted sitemap <lastmod> has not moved. */
  unchangedPerSitemapUrls: string[];
  /** Fetches that failed. They count toward the safety gate. */
  failedFetches: CrawlFailure[];
  /** For sites.requires_headless_rendering. */
  requiresHeadlessRendering: boolean;
  /** True when this crawl made the decision, so the caller can stamp when it was made. */
  decidedHeadlessRendering: boolean;
}

/** Extractor output. Mirrors the extractor's column group in `pages`. */
export interface PageRecord {
  normalisedUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  pageType: PageType;
  languageCode: string | null;
  contentMarkdown: string;
  /** SHA-256 of headings and body text with dates, numbers and whitespace stripped. */
  contentDigest: string;
  /** SHA-256 of what feeds this page's llms.txt entry; the monitor's change signal. */
  listingFieldsHash: string;
}

/** One page as the generator sees it: the record plus crawl signals. */
export interface GeneratorPage {
  record: PageRecord;
  crawlSignals: CrawlSignals;
  markdownVariantUrl: string | null;
}

/** A workspace's edit to one page. Applied as an input on every render. */
export interface WorkspacePageOverride {
  normalisedUrl: string;
  descriptionOverride: string | null;
  isExcluded: boolean;
}

/** Queue names shared by the web app (producer) and the worker (consumer). */
export const QUEUE_NAMES = {
  pipelineRun: 'pipeline-run',
  monitorTick: 'monitor-tick',
} as const;

/** Payload of a `pipeline-run` job. One job is one site's run. */
export interface PipelineRunJob {
  pipelineRunId: string;
  siteId: string;
}

/** Thrown by skeleton functions that have not been written yet. */
export class NotImplementedError extends Error {
  constructor(functionName: string) {
    super(`${functionName} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
