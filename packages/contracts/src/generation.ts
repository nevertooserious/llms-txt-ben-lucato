// What the generator is given: every page of the site, and the user's edits.

import type { CrawlSignals } from './crawl';
import type { StoredPageAssessment } from './page-assessment';
import type { PageRecord } from './page-record';

/** One page as the generator sees it: the record plus crawl signals. */
export interface GeneratorPage {
  record: PageRecord;
  /** Null until the page is assessed. An unassessed page is not listed. */
  assessment: StoredPageAssessment | null;
  /** The URL as the site links it (pages.fetch_url); what the page's entry links when there is no .md variant. */
  fetchUrl: string;
  crawlSignals: CrawlSignals;
  markdownVariantUrl: string | null;
}

/** The user's edit to one page. Applied as an input on every render. */
export interface PageOverride {
  normalisedUrl: string;
  descriptionOverride: string | null;
  isExcluded: boolean;
}

/**
 * Whether a URL is at or under an excluded URL prefix, by whole path segments:
 * `https://example.com/blog` covers `/blog` and `/blog/2024/post`, not `/blog-archive`.
 * A prefix with no path covers its whole host. Query strings and trailing slashes are
 * ignored on both sides.
 */
export function isUrlUnderPrefix(url: string, urlPrefix: string): boolean {
  let page: URL;
  let prefix: URL;
  try {
    page = new URL(url);
    prefix = new URL(urlPrefix);
  } catch {
    return false;
  }
  if (page.origin !== prefix.origin) return false;
  const pagePath = page.pathname.replace(/\/+$/, '');
  const prefixPath = prefix.pathname.replace(/\/+$/, '');
  return pagePath === prefixPath || pagePath.startsWith(`${prefixPath}/`);
}
