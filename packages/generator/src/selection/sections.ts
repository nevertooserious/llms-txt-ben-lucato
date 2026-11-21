import type { GeneratorPage, PageType } from '@llms-txt/contracts';
import { JOB_BOARD_SEGMENT } from './page-kinds';
import type { SelectionLimits } from './selection-limits';
import { pathSegmentsOf, titleCaseOf } from './url-paths';

type SectionedPageType = Exclude<PageType, 'home' | 'legal' | 'other'>;

/** H2 sections in the order they appear, by page type. Legal pages always go under Optional. */
export const SECTION_NAMES: Record<SectionedPageType, string> = {
  docs: 'Docs',
  api: 'API',
  guide: 'Guides',
  product: 'Product',
  pricing: 'Pricing',
  about: 'About',
  blog: 'Blog',
};
/** For pages of type `other` that belong to no area of their own. */
export const GENERAL_SECTION_NAME = 'Pages';
export const OPTIONAL_SECTION_NAME = 'Optional';
/** Pages of type `other` under one first path segment that make an area with its own section. */
const MINIMUM_PAGES_IN_AREA_SECTION = 3;

/**
 * The section names of a selection in the order they are rendered: the page-type
 * sections in their fixed order, then the site's areas with the highest-scoring first,
 * then Pages, then Optional.
 */
export function sectionNamesInOrder(selected: ReadonlyArray<{ sectionName: string }>): string[] {
  return orderSectionNames(selected.map((entry) => entry.sectionName));
}

/** `names` holds each section's name at least once, areas in the order their best pages rank. */
export function orderSectionNames(names: readonly string[]): string[] {
  const fixedNames: string[] = Object.values(SECTION_NAMES);
  const lastNames = [GENERAL_SECTION_NAME, OPTIONAL_SECTION_NAME];
  const areaNames = [...new Set(names)].filter((name) => !fixedNames.includes(name) && !lastNames.includes(name));
  return [...fixedNames, ...areaNames, ...lastNames].filter((name) => names.includes(name));
}

/**
 * Legal pages, job listings and what an assessment calls optional go under Optional. A
 * page of a type goes in that type's section. A page of no particular type goes in its
 * area's section when it has one, and otherwise in Pages.
 */
export function sectionNameOf(
  page: GeneratorPage,
  areaSectionNames: ReadonlyMap<string, string>,
  homepage: GeneratorPage | undefined,
): string {
  const pageType = page.assessment?.pageType ?? page.record.pageType;
  if (pageType === 'legal' || pageType === 'home' || page.assessment?.listingValue === 'optional') {
    return OPTIONAL_SECTION_NAME;
  }
  // Without an assessment to say otherwise, a job board is not what the site is about.
  if (page.assessment === null && pathSegmentsOf(page.record.normalisedUrl).some((segment) => JOB_BOARD_SEGMENT.test(segment))) {
    return OPTIONAL_SECTION_NAME;
  }
  if (pageType !== 'other') return SECTION_NAMES[pageType];
  const firstSegment = segmentsUnderSiteRoot(page, homepage)?.[0];
  return (firstSegment === undefined ? undefined : areaSectionNames.get(firstSegment)) ?? GENERAL_SECTION_NAME;
}

export function sectionLimitOf(sectionName: string, limits: SelectionLimits): number {
  if (sectionName === OPTIONAL_SECTION_NAME) return limits.maxOptionalEntries;
  if (sectionName === SECTION_NAMES.blog) return limits.maxBlogEntries;
  return isDocumentationSection(sectionName) ? limits.maxDocumentationEntriesPerSection : limits.maxEntriesPerSection;
}

export function isDocumentationSection(sectionName: string): boolean {
  return [SECTION_NAMES.docs, SECTION_NAMES.api, SECTION_NAMES.guide].includes(sectionName);
}

/**
 * Sections for the areas of a site that no page type covers: when at least
 * MINIMUM_PAGES_IN_AREA_SECTION pages of type `other` share a first path segment
 * (`/community/...`), they get a section named after it. The name is the navigation's
 * label for the area's own page (`/community`) when there is one, else the segment in
 * title case. Keyed by segment.
 */
export function areaSectionNamesOf(
  eligiblePages: readonly GeneratorPage[],
  candidates: readonly GeneratorPage[],
  homepage: GeneratorPage | undefined,
): Map<string, string> {
  const pageCounts = new Map<string, number>();
  for (const page of eligiblePages) {
    if ((page.assessment?.pageType ?? page.record.pageType) !== 'other') continue;
    if (page.assessment?.listingValue === 'optional') continue;
    const firstSegment = segmentsUnderSiteRoot(page, homepage)?.[0];
    if (firstSegment !== undefined) pageCounts.set(firstSegment, (pageCounts.get(firstSegment) ?? 0) + 1);
  }
  const reservedNames = [...Object.values(SECTION_NAMES), GENERAL_SECTION_NAME, OPTIONAL_SECTION_NAME];
  const names = new Map<string, string>();
  for (const [segment, pageCount] of pageCounts) {
    if (pageCount < MINIMUM_PAGES_IN_AREA_SECTION) continue;
    const areaPage = candidates.find((page) => {
      const segments = segmentsUnderSiteRoot(page, homepage);
      return segments?.length === 1 && segments[0] === segment;
    });
    const name = sectionNameFromText(areaPage?.crawlSignals.navigationLabel ?? '') ?? titleCaseOf(segment);
    // A segment of punctuation alone (`/-/`) names nothing, and an H2 needs a name.
    if (name === '') continue;
    // An area named like a fixed section joins it, so no heading appears twice.
    names.set(segment, reservedNames.find((reserved) => reserved.toLowerCase() === name.toLowerCase()) ?? name);
  }
  return names;
}

/** The page's path segments below the homepage's path, or null on another host. */
function segmentsUnderSiteRoot(page: GeneratorPage, homepage: GeneratorPage | undefined): string[] | null {
  const segments = pathSegmentsOf(page.record.normalisedUrl);
  if (homepage === undefined) return segments;
  if (new URL(page.record.normalisedUrl).origin !== new URL(homepage.record.normalisedUrl).origin) return null;
  const rootSegments = pathSegmentsOf(homepage.record.normalisedUrl);
  const isUnderRoot = rootSegments.every((segment, index) => segments[index] === segment);
  return isUnderRoot ? segments.slice(rootSegments.length) : segments;
}

/** Text fit to be an H2: one line, no markdown that would change what the line is. */
function sectionNameFromText(text: string): string | null {
  const name = text.replace(/[#[\]<>`*_|]/g, ' ').replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(name) ? name : null;
}
