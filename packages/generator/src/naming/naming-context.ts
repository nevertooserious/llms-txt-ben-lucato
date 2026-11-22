import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf } from '../selection';
import { singleLine } from '../text/normalise-text';
import { lastTitlePartOf, MINIMUM_PAGES_SHARING_SITE_NAME } from './title-parts';

/** What the pages of a site share, worked out once per render. */
export interface NamingContext {
  siteTitle: string;
  /** The homepage's own title, which some sites repeat as every page's og:title. */
  homepageTitle: string;
  /** Names that titles end with across the site (`| Acme`, `| Acme Foundation`), longest first. */
  titleSuffixes: readonly string[];
}

export function buildNamingContext(siteTitle: string, pages: readonly GeneratorPage[]): NamingContext {
  const homepage = homepageOf(pages);
  const suffixes = titleEndsOnSeveralPages(pages, new Set());
  // Again without those, for a title that ends with two names: `Page - Project - Publisher`.
  for (const suffix of titleEndsOnSeveralPages(pages, suffixes)) suffixes.add(suffix);
  if (siteTitle !== '') suffixes.add(siteTitle);

  return {
    siteTitle,
    homepageTitle: singleLine(homepage?.record.title ?? ''),
    titleSuffixes: [...suffixes].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)),
  };
}

/**
 * Title endings that enough pages with different content carry, once the endings
 * already known are taken off. Counting distinct content keeps copies of one page (`/a`
 * and `/a?ref=x`) from making its title look like the site's name.
 */
function titleEndsOnSeveralPages(pages: readonly GeneratorPage[], knownEndings: ReadonlySet<string>): Set<string> {
  const contentDigestsByText = new Map<string, Set<string>>();
  for (const page of pages) {
    let title = singleLine(page.record.title ?? '');
    let text = lastTitlePartOf(title);
    if (knownEndings.size > 0) {
      // Only a title that ends with a known name can have a second one before it.
      if (text === null || !knownEndings.has(text)) continue;
      title = title.slice(0, title.lastIndexOf(text)).replace(/[\s|\-–—·•»:]+$/u, '');
      text = lastTitlePartOf(title);
    }
    if (!text) continue;
    let contentDigests = contentDigestsByText.get(text);
    if (contentDigests === undefined) contentDigestsByText.set(text, (contentDigests = new Set()));
    contentDigests.add(page.record.contentDigest);
  }
  return new Set(
    [...contentDigestsByText]
      .filter(([, contentDigests]) => contentDigests.size >= MINIMUM_PAGES_SHARING_SITE_NAME)
      .map(([text]) => text),
  );
}
