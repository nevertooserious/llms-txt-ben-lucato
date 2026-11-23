import type { CrawlResult, KnownPage, RawPage } from '@llms-txt/contracts';
import type { HeadlessRenderer } from '../network/headless-renderer';
import type { HostnameResolver, NetworkPolicy } from '../network/ssrf-guard';

export interface CrawlSiteOptions {
  /** sites.root_url: scheme, host and optional path prefix. */
  rootUrl: string;
  /** Most pages to fetch. Discovery requests (robots.txt, sitemaps, llms.txt, .md probes, machine-readable files) do not count. */
  pageBudget: number;
  /**
   * sites.requires_headless_rendering from an earlier crawl. When null or absent, this
   * crawl decides it by fetching the homepage both ways.
   */
  requiresHeadlessRendering?: boolean | null;
  /** Production leaves this out (public internet only). */
  networkPolicy?: NetworkPolicy;
  resolveHostname?: HostnameResolver;
  /** Least time between two requests to the site. robots.txt Crawl-delay can raise it. */
  minRequestIntervalMs?: number;
  /**
   * No new page is fetched after this long. Crawl-delay is honoured as the site gives it,
   * so a slow site gets fewer pages, not faster requests.
   */
  maxCrawlDurationMs?: number;
  /** Longest wait honoured for a 429's Retry-After before giving up on that URL. */
  maxRetryAfterMs?: number;
  /**
   * A renderer shared across crawls, so its concurrency limit is global to the worker.
   * When absent, the crawl makes its own and closes it at the end.
   */
  headlessRenderer?: HeadlessRenderer;
  /** Called as pages are discovered and fetched, to update pipeline_runs progress. */
  onProgress?: (progress: CrawlProgress) => void;
  /**
   * Called with each page as soon as it is fetched, and awaited before the next fetch,
   * so the caller can extract and store it and let the HTML go. The crawl keeps no page
   * bodies itself.
   */
  onPage: (page: RawPage) => void | Promise<void>;
  /**
   * Pages stored from earlier crawls. Each is queued as well as anything discovery finds,
   * so a page no longer linked is still re-checked and a removal is seen. A known page
   * with validators is fetched with a conditional GET.
   */
  knownPages?: readonly KnownPage[];
  /**
   * sites.sitemap_lastmod_is_trusted. When true, a known page whose sitemap <lastmod> has
   * not moved since the last crawl is not requested at all.
   */
  sitemapLastModifiedIsTrusted?: boolean;
  /**
   * Whether an llms.txt the site already has is read for pages to crawl. On unless false.
   * The eval turns it off, so a site's own file cannot shape the one scored against it.
   */
  readsExistingLlmsTxt?: boolean;
  /**
   * sites.machine_readable_resource_urls from earlier crawls. Each is checked again, so a
   * file found through a page that answers 304 this time is not lost with the link to it.
   */
  knownMachineReadableResourceUrls?: readonly string[];
}

export interface CrawlProgress {
  pagesDiscovered: number;
  pagesFetched: number;
  pagesFailed: number;
}

export type { CrawlResult };
