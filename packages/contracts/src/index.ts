// The typed hand-offs between pipeline stages (docs/design/diagrams/pipeline-contracts.svg):
//
//   crawler:   site URL       -> RawPage[]
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
  /** Where the page ended up after redirects. */
  finalUrl: string;
  httpStatusCode: number;
  /** Response headers, lowercased names. */
  headers: Record<string, string>;
  /** The response body, or the rendered DOM when fetched with the headless browser. */
  html: string;
  fetchMethod: FetchMethod;
  crawlSignals: CrawlSignals;
  markdownVariantUrl: string | null;
}

/** Discovery signals the generator uses to score pages. */
export interface CrawlSignals {
  /** Link hops from the root URL. */
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  isInSiteNavigation: boolean;
  inboundLinkCount: number;
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
