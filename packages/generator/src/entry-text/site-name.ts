import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf } from '../selection';
import { singleLine } from './text';
import { firstTitlePartOf, lastTitlePartOf, MINIMUM_PAGES_SHARING_SITE_NAME, TITLE_SEPARATORS } from './title-parts';

/**
 * The site's name. First what the homepage declares (og:site_name and the like). Else
 * from a homepage title that may also carry a tagline or page name (`The guide – Acme`):
 * the part at either end that at least MINIMUM_PAGES_SHARING_SITE_NAME other pages carry
 * too. Else the name most other pages' titles end or start with, when at least half do
 * (`Welcome to Acme` with pages titled `Docs | Acme`). Otherwise the title is kept.
 */
export function siteNameFrom(homepageTitle: string, pages: readonly GeneratorPage[]): string {
  const declaredSiteName = singleLine(homepageOf(pages)?.record.declaredSiteName ?? '');
  if (declaredSiteName !== '') return declaredSiteName;

  const title = singleLine(homepageTitle);
  const otherTitles = pages
    .filter((page) => page.crawlSignals.crawlDepth > 0)
    .map((page) => singleLine(page.record.title ?? ''))
    .filter((pageTitle) => pageTitle !== '' && pageTitle !== title);

  let siteName = title;
  let mostPagesSharing = MINIMUM_PAGES_SHARING_SITE_NAME - 1;
  for (const separator of TITLE_SEPARATORS) {
    if (!title.includes(separator)) continue;
    const lastPart = title.slice(title.lastIndexOf(separator) + separator.length).trim();
    const firstPart = title.slice(0, title.indexOf(separator)).trim();
    for (const candidate of [lastPart, firstPart]) {
      if (candidate === '') continue;
      const pagesSharing = otherTitles.filter((pageTitle) => carriesSiteName(pageTitle, candidate)).length;
      if (pagesSharing > mostPagesSharing) {
        siteName = candidate;
        mostPagesSharing = pagesSharing;
      }
    }
  }
  if (siteName !== title) return siteName;

  const pagesByTitleEnd = new Map<string, number>();
  for (const pageTitle of otherTitles) {
    for (const part of new Set([lastTitlePartOf(pageTitle), firstTitlePartOf(pageTitle)])) {
      if (part !== null) pagesByTitleEnd.set(part, (pagesByTitleEnd.get(part) ?? 0) + 1);
    }
  }
  const [mostCommon] = [...pagesByTitleEnd].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const pagesNeeded = Math.max(MINIMUM_PAGES_SHARING_SITE_NAME, otherTitles.length / 2);
  return mostCommon !== undefined && mostCommon[1] >= pagesNeeded ? mostCommon[0] : title;
}

function carriesSiteName(title: string, siteName: string): boolean {
  return TITLE_SEPARATORS.some(
    (separator) => title.endsWith(`${separator}${siteName}`) || title.startsWith(`${siteName}${separator}`),
  );
}
