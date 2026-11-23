import { parseSitemap, type SitemapEntry } from '../discovery/parse-sitemap';
import type { CrawlFrontier } from './frontier';
import { htmlUrlForMarkdownLink } from './markdown-variants';
import { TEXT_TYPES } from './media-types';
import type { PoliteFetcher } from './polite-fetcher';
import type { RobotsGate } from './robots-gate';

/** The sitemaps protocol caps a sitemap file at 50 MB uncompressed. */
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
/** Sitemap files fetched per crawl, index files included. */
const MAX_SITEMAP_FETCHES = 10;
/**
 * Sitemap URLs kept per page of budget; a huge sitemap need not be held in full. Of a
 * sitemap with more, the URLs nearest the root are kept, in the sitemap's order: a sitemap
 * lists a site by path, and its first URLs are the start of the alphabet, not what matters.
 */
const SITEMAP_ENTRIES_PER_BUDGETED_PAGE = 4;

/** What seeding reads from, and the crawl's own rules for what may join the frontier. */
export interface FrontierSeeding {
  rootUrl: string;
  pageBudget: number;
  politeFetcher: PoliteFetcher;
  robots: RobotsGate;
  frontier: CrawlFrontier;
  /** Adds a page found in a sitemap, at the place the sitemap gave it. Returns whether it was added. */
  addSitemapPage: (url: string, lastModified: string | null, order: number) => boolean;
  /** Adds a page the site's own llms.txt links. */
  addLlmsTxtPage: (url: string) => void;
  /** Notes a link that names a machine-readable file. Returns whether it does. */
  addMachineReadableResourceCandidate: (href: string, baseUrl: string) => boolean;
}

/** Queues the pages of the sitemaps robots.txt lists, or of `/sitemap.xml` when it lists none. */
export async function seedFromSitemaps(seeding: FrontierSeeding): Promise<void> {
  const { rootUrl, politeFetcher, robots } = seeding;
  const listedInRobotsTxt = robots.sitemapUrls.length > 0;
  const queue = listedInRobotsTxt ? [...robots.sitemapUrls] : [new URL('/sitemap.xml', rootUrl).href];
  const seen = new Set<string>();
  const maxEntries = seeding.pageBudget * SITEMAP_ENTRIES_PER_BUDGETED_PAGE;
  let entriesAdded = 0;

  while (queue.length > 0 && seen.size < MAX_SITEMAP_FETCHES && entriesAdded < maxEntries) {
    const sitemapUrl = queue.shift()!;
    if (seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);
    // A sitemap robots.txt lists is invited; one found by guessing is subject to its rules.
    if (!listedInRobotsTxt && !robots.isAllowed(sitemapUrl)) continue;
    const outcome = await politeFetcher.fetch({
      url: sitemapUrl,
      // Sitemaps are served under many media types; the parser decides what it is.
      acceptedContentTypes: ['*/*'],
      maxResponseBytes: MAX_SITEMAP_BYTES,
      decompressGzip: true,
      ...(!listedInRobotsTxt && { isRedirectAllowed: robots.isRedirectAllowed }),
    });
    if (outcome.kind !== 'response' || outcome.httpStatusCode !== 200) continue;

    const sitemap = parseSitemap(outcome.body);
    if (sitemap.kind === 'sitemapindex') queue.push(...sitemap.sitemapUrls);
    else if (sitemap.kind === 'urlset') entriesAdded += addSitemapEntries(seeding, sitemap.entries, maxEntries - entriesAdded);
  }
}

/** Adds up to `limit` of a sitemap's pages, those nearest the root first. Returns how many were added. */
function addSitemapEntries(seeding: FrontierSeeding, entries: readonly SitemapEntry[], limit: number): number {
  // Each entry keeps the place the sitemap gave it, whenever it is added.
  const firstOrder = seeding.frontier.reserveOrder(entries.length);
  let entriesAdded = 0;
  for (const index of indexesNearestRootFirst(entries.map((entry) => entry.url))) {
    if (entriesAdded >= limit) break;
    const { url, lastModified } = entries[index]!;
    if (seeding.addSitemapPage(url, lastModified, firstOrder + index)) entriesAdded += 1;
  }
  return entriesAdded;
}

/**
 * Queues the pages the site's own llms.txt links, when it has one: they are the pages the
 * site chose. The file itself is not reused; a new one is generated from the crawl.
 */
export async function seedFromExistingLlmsTxt(seeding: FrontierSeeding): Promise<void> {
  const { rootUrl, politeFetcher, robots } = seeding;
  const candidates = [...new Set([`${rootUrl}/llms.txt`, new URL('/llms.txt', rootUrl).href])];
  for (const llmsTxtUrl of candidates) {
    if (!robots.isAllowed(llmsTxtUrl)) continue;
    const outcome = await politeFetcher.fetch({
      url: llmsTxtUrl,
      acceptedContentTypes: TEXT_TYPES,
      isRedirectAllowed: robots.isRedirectAllowed,
    });
    if (outcome.kind !== 'response' || outcome.httpStatusCode !== 200) continue;
    for (const match of outcome.body.matchAll(/\]\(\s*<?([^)\s>]+)>?\s*\)/g)) {
      if (seeding.addMachineReadableResourceCandidate(match[1]!, outcome.finalUrl)) continue;
      const linkedUrl = htmlUrlForMarkdownLink(match[1]!, outcome.finalUrl);
      if (linkedUrl !== null) seeding.addLlmsTxtPage(linkedUrl);
    }
    return;
  }
}

/** The indexes of the URLs, those with the fewest path segments first and otherwise in order. */
function indexesNearestRootFirst(urls: readonly string[]): number[] {
  const depths = urls.map((url) => (URL.canParse(url) ? new URL(url).pathname.split('/').filter(Boolean).length : Infinity));
  return urls.map((_, index) => index).sort((a, b) => depths[a]! - depths[b]! || a - b);
}
