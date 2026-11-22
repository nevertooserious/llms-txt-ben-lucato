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
  /** The pages of the site this page links, as normalised URLs (pages.outbound_link_urls). Empty until it is read. */
  outboundLinkUrls: readonly string[];
}

/** The user's edit to one page. Applied as an input on every render. */
export interface PageOverride {
  normalisedUrl: string;
  descriptionOverride: string | null;
  isExcluded: boolean;
  /** Listed even if the assessment or a selection rule would leave it out. An exclusion still wins. */
  isKept: boolean;
}

/**
 * The client-side route a URL's fragment names, as a path: `/install` for `#/install`,
 * `#!/install` and `#/install?id=usage`. Empty when the fragment is not a route, or is
 * the root route (`#/`). Only the pages of a site that routes on the fragment have one
 * (docs/design/README.md, section 2, Hash-routed sites).
 */
export function fragmentRoutePathOf(url: URL): string {
  const route = /^#!?\/([^?]*)/.exec(url.hash)?.[1] ?? '';
  // Sites write the same route several ways (`#/./plugins`, `#/guide/../plugins`).
  const segments: string[] = [];
  for (const segment of route.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

/**
 * Where a page stands in its site: the URL's path without trailing slashes, then its
 * fragment route. `/docs/guide` for `https://example.com/docs/guide/`, and `/install`
 * for `https://example.com/#/install`.
 */
export function pagePathOf(url: URL): string {
  return `${url.pathname.replace(/\/+$/, '')}${fragmentRoutePathOf(url)}`;
}

/**
 * Whether a URL is at or under an excluded URL prefix, by whole path segments:
 * `https://example.com/blog` covers `/blog` and `/blog/2024/post`, not `/blog-archive`.
 * A prefix with no path covers its whole host. Query strings and trailing slashes are
 * ignored on both sides. On a site that routes on the URL fragment, the route counts as
 * path: `https://example.com/#/guide` covers `/#/guide/setup`.
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
  const pagePath = pagePathOf(page);
  const prefixPath = pagePathOf(prefix);
  return pagePath === prefixPath || pagePath.startsWith(`${prefixPath}/`);
}
