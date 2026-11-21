import type { GeneratorPage, WorkspacePageOverride } from '@llms-txt/contracts';
import { listingCandidates } from './listing-candidates';
import { homepageOf, isDocumentationType } from './page-kinds';
import { scorePage } from './score-page';
import { areaSectionNamesOf, isDocumentationSection, OPTIONAL_SECTION_NAME, orderSectionNames, sectionLimitOf, sectionNameOf } from './sections';
import { DEFAULT_SELECTION_LIMITS, type SelectionLimits } from './selection-limits';
import { canonicalKey, compareText } from './url-paths';

/** Entries a documentation section takes for each one another section takes, when the file is full. */
const DOCUMENTATION_SHARE_OF_A_FULL_FILE = 2;

export interface SelectedPage {
  page: GeneratorPage;
  score: number;
  /** A name from SECTION_NAMES, or OPTIONAL_SECTION_NAME. */
  sectionName: string;
  descriptionOverride: string | null;
}

/**
 * Takes the listing candidates, minus pages a workspace excluded or an assessment judged
 * not to belong; keeps one page per canonical URL; drops pages that score too low; then
 * fills the sections in score order within the limits. Pages that score the same keep
 * the order of the site's navigation, then the order the crawl first saw links to them,
 * then of their URLs. A page beyond a limit is left
 * out: Optional holds pages that are secondary by nature, not the overflow. An
 * assessment's page type replaces the extractor's.
 */
export function selectPages(
  pages: readonly GeneratorPage[],
  overrides: readonly WorkspacePageOverride[],
  limits: SelectionLimits = DEFAULT_SELECTION_LIMITS,
): SelectedPage[] {
  const overridesByUrl = new Map(overrides.map((override) => [override.normalisedUrl, override]));

  const candidates = listingCandidates(pages).filter(
    (page) =>
      overridesByUrl.get(page.record.normalisedUrl)?.isExcluded !== true && page.assessment?.listingValue !== 'exclude',
  );

  const ranked = keepOnePerCanonicalUrl(candidates)
    .map((page) => ({ page, score: scorePage(page) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        navigationOrderOf(a.page) - navigationOrderOf(b.page) ||
        linkOrderOf(a.page) - linkOrderOf(b.page) ||
        compareText(a.page.record.normalisedUrl, b.page.record.normalisedUrl),
    );

  const eligible = ranked.filter(
    ({ page, score }, rank) =>
      rank < limits.entriesListedWhateverTheirScore ||
      score >= limits.minimumScore ||
      isDocumentationType(page.assessment?.pageType ?? page.record.pageType),
  );
  const homepage = homepageOf(pages);
  const areaSectionNames = areaSectionNamesOf(eligible.map((entry) => entry.page), candidates, homepage);

  // Each section's pages in score order, within the section's limit.
  const sectionEntries = new Map<string, Array<{ page: GeneratorPage; score: number }>>();
  for (const entry of eligible) {
    const sectionName = sectionNameOf(entry.page, areaSectionNames, homepage);
    let entries = sectionEntries.get(sectionName);
    if (entries === undefined) sectionEntries.set(sectionName, (entries = []));
    if (entries.length < sectionLimitOf(sectionName, limits)) entries.push(entry);
  }

  // When the sections together hold more than the file may, they are filled a round at a
  // time, so the limit cuts every section's tail and not whichever sections come last.
  const primarySectionNames = orderSectionNames([...sectionEntries.keys()]).filter((name) => name !== OPTIONAL_SECTION_NAME);
  const sectionNameByUrl = new Map<string, string>();
  for (const { page } of sectionEntries.get(OPTIONAL_SECTION_NAME) ?? []) {
    sectionNameByUrl.set(page.record.normalisedUrl, OPTIONAL_SECTION_NAME);
  }
  let primaryCount = 0;
  for (let round = 0; primaryCount < limits.maxPrimaryEntries; round += 1) {
    const countBeforeRound = primaryCount;
    for (const sectionName of primarySectionNames) {
      const share = isDocumentationSection(sectionName) ? DOCUMENTATION_SHARE_OF_A_FULL_FILE : 1;
      const roundEntries = sectionEntries.get(sectionName)!.slice(round * share, (round + 1) * share);
      for (const { page } of roundEntries.slice(0, limits.maxPrimaryEntries - primaryCount)) {
        sectionNameByUrl.set(page.record.normalisedUrl, sectionName);
        primaryCount += 1;
      }
    }
    if (primaryCount === countBeforeRound) break;
  }

  return eligible.flatMap(({ page, score }) => {
    const sectionName = sectionNameByUrl.get(page.record.normalisedUrl);
    if (sectionName === undefined) return [];
    return [
      {
        page,
        score,
        sectionName,
        descriptionOverride: overridesByUrl.get(page.record.normalisedUrl)?.descriptionOverride ?? null,
      },
    ];
  });
}

/** Pages that score the same keep the order the site's navigation gives them; the rest follow. */
function navigationOrderOf(page: GeneratorPage): number {
  return page.crawlSignals.navigationPosition ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Then the order in which the crawl first saw links to them, which is the order of the
 * site's sidebars and index pages. A documentation site links every page from every
 * page, so its pages all score the same, and without this the first entries of a
 * section would be whichever URLs come first in the alphabet.
 */
function linkOrderOf(page: GeneratorPage): number {
  return page.crawlSignals.firstLinkPosition ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Pages that declare the same canonical URL are one page. The one at that URL wins;
 * otherwise the highest-scoring one.
 */
function keepOnePerCanonicalUrl(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const byCanonical = new Map<string, GeneratorPage>();
  for (const page of pages) {
    const key = canonicalKey(page.record.canonicalUrl ?? page.record.normalisedUrl);
    const current = byCanonical.get(key);
    if (current === undefined || isBetterRepresentative(page, current, key)) byCanonical.set(key, page);
  }
  return [...byCanonical.values()];
}

function isBetterRepresentative(candidate: GeneratorPage, current: GeneratorPage, key: string): boolean {
  const candidateIsCanonical = canonicalKey(candidate.record.normalisedUrl) === key;
  const currentIsCanonical = canonicalKey(current.record.normalisedUrl) === key;
  if (candidateIsCanonical !== currentIsCanonical) return candidateIsCanonical;
  const scoreDifference = scorePage(candidate) - scorePage(current);
  if (scoreDifference !== 0) return scoreDifference > 0;
  return compareText(candidate.record.normalisedUrl, current.record.normalisedUrl) < 0;
}
