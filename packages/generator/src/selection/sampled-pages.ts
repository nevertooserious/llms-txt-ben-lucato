import type { GeneratorPage } from '@llms-txt/contracts';
import { pagePathSegmentsOf } from './url-paths';

/** An index must link at least this many pages of one directory... */
const MINIMUM_PAGES_LINKED_BY_INDEX = 100;
/** ...of which the crawl read at most this share, for those read to be a sample. */
const MAXIMUM_SHARE_OF_LINKED_PAGES_CRAWLED = 0.05;

/**
 * Pages that are a sample of what a listed index page links. A crawl under a page budget
 * or time limit reads a few of a large family: a dozen of the several hundred packages
 * under `/software/` that the software index links. Which few is chance, and listing them
 * says nothing about the site, so the index stands for them all.
 *
 * A family is the pages an index links in one directory. It is sampled when the index
 * links a great many and the crawl read hardly any. Both limits are far from the
 * ordinary: an essay that links its forty translations, or an index of 170 essays of
 * which the crawl read twenty, lists pages the site means to be read, and gnu.org has
 * both. A page the navigation or the site's own llms.txt names was chosen by the site,
 * not by the crawl, and stays.
 */
export function pagesSampledFromListedIndex(
  candidates: readonly GeneratorPage[],
  crawledPages: readonly GeneratorPage[],
): GeneratorPage[] {
  const crawledUrls = new Set(crawledPages.map((page) => page.record.normalisedUrl));
  const sampledUrls = new Set<string>();
  for (const index of candidates) {
    const linkedByDirectory = new Map<string, Set<string>>();
    for (const linkUrl of index.outboundLinkUrls) {
      const directory = directoryKeyOf(linkUrl);
      if (directory === null || linkUrl === index.record.normalisedUrl) continue;
      let linked = linkedByDirectory.get(directory);
      if (linked === undefined) linkedByDirectory.set(directory, (linked = new Set()));
      linked.add(linkUrl);
    }
    for (const linked of linkedByDirectory.values()) {
      if (linked.size < MINIMUM_PAGES_LINKED_BY_INDEX) continue;
      const crawled = [...linked].filter((url) => crawledUrls.has(url));
      if (crawled.length > linked.size * MAXIMUM_SHARE_OF_LINKED_PAGES_CRAWLED) continue;
      for (const url of crawled) sampledUrls.add(url);
    }
  }
  return candidates.filter(
    (page) =>
      sampledUrls.has(page.record.normalisedUrl) &&
      !page.crawlSignals.isInSiteNavigation &&
      page.crawlSignals.discoveredVia !== 'existing_llms_txt',
  );
}

/** The directory a URL's page is in, with its origin; null for a URL that cannot be read. */
function directoryKeyOf(url: string): string | null {
  try {
    return JSON.stringify([new URL(url).origin, pagePathSegmentsOf(url).slice(0, -1)]);
  } catch {
    return null;
  }
}
