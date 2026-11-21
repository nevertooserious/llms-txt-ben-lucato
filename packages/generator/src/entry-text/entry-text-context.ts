import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf } from '../selection';
import { singleLine } from './text';
import { lastTitlePartOf, MINIMUM_PAGES_SHARING_SITE_NAME } from './title-parts';

/** What the pages of a site share, worked out once per render. */
export interface EntryTextContext {
  siteTitle: string;
  /** The homepage's own title, which some sites repeat as every page's og:title. */
  homepageTitle: string;
  /** Names that titles end with across the site (`| Acme`, `| Acme Foundation`), longest first. */
  titleSuffixes: readonly string[];
}

export function buildEntryTextContext(siteTitle: string, pages: readonly GeneratorPage[]): EntryTextContext {
  const homepage = homepageOf(pages);
  const suffixes = titleEndsOnSeveralPages(pages);
  if (siteTitle !== '') suffixes.add(siteTitle);

  return {
    siteTitle,
    homepageTitle: singleLine(homepage?.record.title ?? ''),
    titleSuffixes: [...suffixes].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)),
  };
}

/**
 * Title endings that enough pages with different content carry. Counting distinct
 * content keeps copies of one page (`/a` and `/a?ref=x`) from making its title look
 * like the site's name.
 */
function titleEndsOnSeveralPages(pages: readonly GeneratorPage[]): Set<string> {
  const contentDigestsByText = new Map<string, Set<string>>();
  for (const page of pages) {
    const text = lastTitlePartOf(singleLine(page.record.title ?? ''));
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
