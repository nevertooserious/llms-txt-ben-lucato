import type { GeneratorPage } from '@llms-txt/contracts';

/** Fewer assessed siblings than this say too little about what their folder holds. */
const MINIMUM_PAGES_IN_REFERENCE_FAMILY = 5;

/**
 * Each page is assessed alone, so of a hundred pages for single configuration options the
 * model calls some reference entries and lists others. Where the pages directly under one
 * path hold more reference entries than primary pages, that path is a reference, and its
 * remaining pages are left out with them: the index page above them stands for all. A page
 * the navigation names is kept. One the site's own llms.txt names is not: such a file
 * often lists every page of the documentation.
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
  return candidates.filter((page) => {
    if (page.crawlSignals.isInSiteNavigation) return true;
    const verdicts = verdictsByFamily.get(familyKeyOf(page));
    if (verdicts === undefined) return true;
    const isReferenceFamily =
      verdicts.referenceEntries >= MINIMUM_PAGES_IN_REFERENCE_FAMILY && verdicts.referenceEntries > verdicts.primary;
    return !isReferenceFamily;
  });
}

/** The origin and the path above the page: `/config` for `/config/watch`. */
function familyKeyOf(page: GeneratorPage): string {
  const url = new URL(page.record.normalisedUrl);
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  return JSON.stringify([url.origin, segments.slice(0, -1)]);
}
