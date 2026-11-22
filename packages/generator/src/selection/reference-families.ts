import type { GeneratorPage } from '@llms-txt/contracts';
import { pathKeyOf } from './broader-pages';
import { homepageOf } from './page-kinds';
import { pagePathSegmentsOf } from './url-paths';

/** Fewer assessed siblings than this say too little about what their folder holds. */
const MINIMUM_PAGES_IN_REFERENCE_FAMILY = 5;

/**
 * Each page is assessed alone, so of a hundred pages for single configuration options the
 * model calls some reference entries and lists others. Where the pages directly under one
 * path hold more reference entries than primary pages, that path is a reference, and its
 * remaining pages are left out with them: the index page above them stands for all. A page
 * the navigation names is kept. One the site's own llms.txt names is not: such a file
 * often lists every page of the documentation. With no index page left to stand for them,
 * the folder's remaining pages stay.
 */
export function withoutReferenceFamilies(
  candidates: readonly GeneratorPage[],
  allPages: readonly GeneratorPage[],
): GeneratorPage[] {
  const verdictsByFamily = new Map<string, { referenceEntries: number; primary: number }>();
  for (const page of allPages) {
    if (page.assessment === null) continue;
    const key = familyKeyOf(page);
    let verdicts = verdictsByFamily.get(key);
    if (verdicts === undefined) verdictsByFamily.set(key, (verdicts = { referenceEntries: 0, primary: 0 }));
    if (page.assessment.exclusionReason === 'reference_entry') verdicts.referenceEntries += 1;
    else if (page.assessment.listingValue === 'primary') verdicts.primary += 1;
  }
  const homepage = homepageOf(allPages);
  const pagePathKeys = new Set([...candidates, ...(homepage ? [homepage] : [])].map(pathKeyOf));
  return candidates.filter((page) => {
    if (page.crawlSignals.isInSiteNavigation) return true;
    const familyKey = familyKeyOf(page);
    const verdicts = verdictsByFamily.get(familyKey);
    if (verdicts === undefined || !pagePathKeys.has(familyKey)) return true;
    const isReferenceFamily =
      verdicts.referenceEntries >= MINIMUM_PAGES_IN_REFERENCE_FAMILY && verdicts.referenceEntries > verdicts.primary;
    return !isReferenceFamily;
  });
}

/** The origin and the path above the page: `/config` for `/config/watch`, `/` for `/config/index.html`. */
function familyKeyOf(page: GeneratorPage): string {
  const url = page.record.normalisedUrl;
  return JSON.stringify([new URL(url).origin, pagePathSegmentsOf(url).slice(0, -1)]);
}
