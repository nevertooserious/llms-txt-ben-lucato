import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf } from '../selection';
import { singleLine } from '../text/normalise-text';
import { firstTitlePartOf, lastTitlePartOf, MINIMUM_PAGES_SHARING_SITE_NAME, titlePartsOf } from './title-parts';

/**
 * The site's name. First what the homepage declares (og:site_name and the like), unless
 * that is just its whole title. Else from a homepage title that may also carry a tagline
 * or page name (`The guide – Acme`, `Docs | Acme - A fast tool`): the part that at least
 * MINIMUM_PAGES_SHARING_SITE_NAME other pages' titles carry too. Else the name most other pages' titles end or start with, when at least half do
 * (`Welcome to Acme` with pages titled `Docs | Acme`). Otherwise the title is kept.
 */
export function siteNameFrom(homepageTitle: string, pages: readonly GeneratorPage[]): string {
  const title = singleLine(homepageTitle);
  const titleParts = titlePartsOf(title);
  const declaredSiteName = singleLine(homepageOf(pages)?.record.declaredSiteName ?? '');
  // Some sites declare their whole homepage title as the site's name; that says nothing.
  const declaresOnlyItsTitle = declaredSiteName === title && titleParts.length > 1;
  if (declaredSiteName !== '' && !declaresOnlyItsTitle) return declaredSiteName;

  const otherTitles = pages
    .filter((page) => page.crawlSignals.crawlDepth > 0)
    .map((page) => singleLine(page.record.title ?? ''))
    .filter((pageTitle) => pageTitle !== '' && pageTitle !== title);
  return sharedTitlePartOf(title, titleParts, otherTitles.map(titlePartsOf)) ?? mostCommonTitleEndOf(otherTitles) ?? title;
}

/**
 * The part of the homepage's title that the most other pages' titles carry too. Of parts
 * as many pages share (`Docs | Acme - A fast tool` on every page), the shorter is the
 * name and the longer the tagline.
 */
function sharedTitlePartOf(title: string, titleParts: readonly string[], otherTitleParts: readonly (readonly string[])[]): string | null {
  if (titleParts.length <= 1) return null;
  let siteName: string | null = null;
  let mostPagesSharing = MINIMUM_PAGES_SHARING_SITE_NAME - 1;
  for (const candidate of titleParts) {
    const pagesSharing = otherTitleParts.filter((parts) => parts.length > 1 && parts.includes(candidate)).length;
    const isShorterOfEqual = pagesSharing === mostPagesSharing && siteName !== null && candidate.length < siteName.length;
    if (pagesSharing > mostPagesSharing || isShorterOfEqual) {
      siteName = candidate;
      mostPagesSharing = pagesSharing;
    }
  }
  return siteName === title ? null : siteName;
}

/** The name most other pages' titles end or start with, when at least half do. */
function mostCommonTitleEndOf(otherTitles: readonly string[]): string | null {
  const pagesByTitleEnd = new Map<string, number>();
  for (const pageTitle of otherTitles) {
    for (const part of new Set([lastTitlePartOf(pageTitle), firstTitlePartOf(pageTitle)])) {
      if (part !== null) pagesByTitleEnd.set(part, (pagesByTitleEnd.get(part) ?? 0) + 1);
    }
  }
  const [mostCommon] = [...pagesByTitleEnd].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const pagesNeeded = Math.max(MINIMUM_PAGES_SHARING_SITE_NAME, otherTitles.length / 2);
  return mostCommon !== undefined && mostCommon[1] >= pagesNeeded ? mostCommon[0] : null;
}
