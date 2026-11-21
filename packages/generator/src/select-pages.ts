import type { GeneratorPage, PageType, WorkspacePageOverride } from '@llms-txt/contracts';

// Which pages are listed, and where. Sections come from page type and, for pages of no
// particular type, from the area of the site they sit in; the LLM never chooses them.
// Pure and deterministic: ties are broken by URL.

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

export interface SelectionLimits {
  /** Most entries in one section. Pages beyond a limit are left out, not moved to Optional. */
  maxEntriesPerSection: number;
  /** Docs, API and Guides are what the file is for, so their sections are larger. */
  maxDocumentationEntriesPerSection: number;
  /** Blog posts are numerous and individually minor, so their section is smaller. */
  maxBlogEntries: number;
  /** Most entries outside Optional. */
  maxPrimaryEntries: number;
  /** Most entries under Optional. */
  maxOptionalEntries: number;
  /**
   * A page scoring less is left out, so a large site's file does not fill up to the
   * limits with pages hardly anything links. Documentation is exempt: it is what the
   * file is for, and a docs page is often linked from its index alone.
   */
  minimumScore: number;
  /** The highest-scoring pages listed whatever they score, so a small site lists all it has. */
  entriesListedWhateverTheirScore: number;
}

export const DEFAULT_SELECTION_LIMITS: SelectionLimits = {
  maxEntriesPerSection: 8,
  maxDocumentationEntriesPerSection: 15,
  maxBlogEntries: 3,
  maxPrimaryEntries: 40,
  maxOptionalEntries: 15,
  minimumScore: 3,
  entriesListedWhateverTheirScore: 10,
};

/** An inbound-link score above this says "linked from a template", not "more important". */
const MAXIMUM_INBOUND_LINK_SCORE = 3;
/** Taken off per path segment beyond the first: deep pages are details of shallower ones. */
const PATH_DEPTH_PENALTY = 0.5;
/** Pages of type `other` under one first path segment that make an area with its own section. */
const MINIMUM_PAGES_IN_AREA_SECTION = 3;
/** Sibling pages three or more segments deep that make a family too large to list. */
const MINIMUM_PAGES_IN_COLLAPSED_FAMILY = 5;
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
 * How important a page looks from how the site links it: being in the navigation counts
 * most, then nearness to the homepage, then how many pages link to it, up to a point: a
 * sidebar that links every filter page from every listing page says nothing about them.
 * A page the site's own llms.txt lists gets a lift, since the site chose it, and a page
 * deep in the URL tree loses a little.
 */
export function scorePage(page: GeneratorPage): number {
  const signals = page.crawlSignals;
  return (
    (signals.isInSiteNavigation ? 4 : 0) +
    3 / (1 + signals.crawlDepth) +
    Math.min(Math.log2(1 + signals.inboundLinkCount), MAXIMUM_INBOUND_LINK_SCORE) +
    (signals.discoveredVia === 'existing_llms_txt' ? 2 : 0) -
    PATH_DEPTH_PENALTY * Math.max(0, pathSegmentsOf(page.record.normalisedUrl).length - 1)
  );
}

/**
 * The pages that could be listed, by rules that need no LLM: not the homepage (it is the
 * H1) under any of its URLs or with its content at another URL, noindex pages,
 * pagination, utility pages (login, cart), archive listings (tag, category), numbered
 * records, what sits under a job board, large families of deep sibling pages, or pages
 * in another language than the site's; and one page per set of URL variants. These are
 * the pages worth paying to assess.
 */
export function listingCandidates(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const siteLanguage = primaryLanguageOf(pages);
  const homepage = homepageOf(pages);
  const homepageVariantKey = homepage === undefined ? null : urlVariantKey(homepage);
  return withoutLargeDeepFamilies(
    keepOnePerUrlVariant(
      pages.filter(
        (page) =>
          page.record.pageType !== 'home' &&
          page.crawlSignals.crawlDepth > 0 &&
          urlVariantKey(page) !== homepageVariantKey &&
          page.record.contentDigest !== homepage?.record.contentDigest &&
          !page.crawlSignals.hasNoindexDirective &&
          !isPaginationUrl(page.record.normalisedUrl) &&
          !isUtilityPage(page) &&
          !isArchiveOrRecordPage(page) &&
          !isOtherLanguage(page, siteLanguage),
      ),
    ),
  );
}

const UTILITY_SEGMENT =
  /^(?:log-?in|log-?out|sign-?in|sign-?out|sign-?up|register|accounts?|my-account|cart|basket|checkout|unsubscribe|password|reset-password|forgot-password|auth|oauth|sso)$/;
/** As the last path segment these are an action on the section, not a page of it. */
const UTILITY_ACTION_SEGMENT = /^(?:create|new|edit|submit|delete|search)$/;
/** A URL carrying one of these is a step on the way to another page. */
const RETURN_PARAMETER_NAMES = ['next', 'redirect', 'redirect_to', 'redirect_uri', 'return', 'return_to', 'returnto', 'returnurl', 'continue'];
const ARCHIVE_SEGMENT = /^(?:category|categories|tag|tags|author|authors|archive|archives)$/;
/** As the last path segment: a listing of what is over (`/events/past`). */
const ARCHIVE_LAST_SEGMENT = /^(?:past|archived?)$/;
/** The job board or careers page itself is listed, under Optional; what is under it is not. */
const JOB_BOARD_SEGMENT = /^(?:jobs|careers)$/;

/**
 * Documentation writes about logging in, accounts and tags, at URLs that say so
 * (`/docs/auth`, `/docs/api/tags`), so these URL rules leave it alone.
 */
function isDocumentationPage(page: GeneratorPage): boolean {
  return isDocumentationType(page.record.pageType);
}

function isDocumentationType(pageType: PageType): boolean {
  return pageType === 'docs' || pageType === 'api' || pageType === 'guide';
}

/** Login, sign-up, cart, search and the like: pages to use the site with, not to read. */
function isUtilityPage(page: GeneratorPage): boolean {
  if (isDocumentationPage(page) || page.record.pageType === 'product') return false;
  const url = new URL(page.record.normalisedUrl);
  if (RETURN_PARAMETER_NAMES.some((name) => url.searchParams.has(name))) return true;
  const segments = pathSegmentsOf(page.record.normalisedUrl);
  return segments.some((segment) => UTILITY_SEGMENT.test(segment)) || UTILITY_ACTION_SEGMENT.test(segments.at(-1) ?? '');
}

/**
 * A tag, category or author listing, a page under a job board, or one numbered record
 * (`/events/8219`): the site's stream of content, not its structure. A numbered page the
 * navigation links (`/report/2024`) is one the site chose to show, and numbered blog
 * posts are left to the Blog section's own small limit.
 */
function isArchiveOrRecordPage(page: GeneratorPage): boolean {
  if (isDocumentationPage(page)) return false;
  const segments = pathSegmentsOf(page.record.normalisedUrl);
  const lastSegment = segments.at(-1) ?? '';
  if (segments.some((segment) => ARCHIVE_SEGMENT.test(segment)) || ARCHIVE_LAST_SEGMENT.test(lastSegment)) return true;
  // Postings and their filters come and go; the board is the durable page.
  if (segments.slice(0, -1).some((segment) => JOB_BOARD_SEGMENT.test(segment))) return true;
  return /^\d+$/.test(lastSegment) && !page.crawlSignals.isInSiteNavigation && page.record.pageType !== 'blog';
}

/**
 * Five or more sibling pages three or more path segments deep (`/jobs/location/berlin`,
 * `/downloads/release/3-12-1`) are one listing's items, and the listing page stands for
 * them. Documentation is often that deep and is kept, as is any page the navigation or
 * the site's own llms.txt names.
 */
function withoutLargeDeepFamilies(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const familyKeyOf = (page: GeneratorPage): string | null => {
    const { isInSiteNavigation, discoveredVia } = page.crawlSignals;
    if (isDocumentationPage(page) || isInSiteNavigation || discoveredVia === 'existing_llms_txt') return null;
    const segments = pathSegmentsOf(page.record.normalisedUrl);
    const depth = LOCALE_SEGMENT.test(segments[0] ?? '') ? segments.length - 1 : segments.length;
    return depth < 3 ? null : JSON.stringify([new URL(page.record.normalisedUrl).origin, segments.slice(0, -1)]);
  };
  const familySizes = new Map<string, number>();
  for (const page of pages) {
    const key = familyKeyOf(page);
    if (key !== null) familySizes.set(key, (familySizes.get(key) ?? 0) + 1);
  }
  return pages.filter((page) => {
    const key = familyKeyOf(page);
    return key === null || familySizes.get(key)! < MINIMUM_PAGES_IN_COLLAPSED_FAMILY;
  });
}

const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/;

/** The URL's path segments, lowercased and decoded. */
export function pathSegmentsOf(url: string): string[] {
  return new URL(url).pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    });
}

/**
 * `/guide`, `/guide/`, `/guide.html`, `/guide.md` and `/guide/index.html` are one page when
 * their content is the same. Different content at such URLs stays separate.
 */
function urlVariantKey(page: GeneratorPage): string {
  const url = new URL(page.record.normalisedUrl);
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\.md$/i, '')
    .replace(/\.html?$/i, '')
    .replace(/\/index$/i, '');
  return JSON.stringify([url.origin, path, url.search, page.record.contentDigest]);
}

/** The URL the page declares as canonical wins, then one with a markdown version. */
function keepOnePerUrlVariant(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const byVariantKey = new Map<string, GeneratorPage>();
  for (const page of pages) {
    const key = urlVariantKey(page);
    const current = byVariantKey.get(key);
    if (current === undefined || isBetterUrlVariant(page, current)) byVariantKey.set(key, page);
  }
  return [...byVariantKey.values()];
}

/** Ignores crawl scores, so the listed URL does not flip as inbound link counts change. */
function isBetterUrlVariant(candidate: GeneratorPage, current: GeneratorPage): boolean {
  const candidateIsCanonical = declaresItselfCanonical(candidate);
  if (candidateIsCanonical !== declaresItselfCanonical(current)) return candidateIsCanonical;
  const candidateHasMarkdown = candidate.markdownVariantUrl !== null;
  if (candidateHasMarkdown !== (current.markdownVariantUrl !== null)) return candidateHasMarkdown;
  return compareText(candidate.record.normalisedUrl, current.record.normalisedUrl) < 0;
}

function declaresItselfCanonical(page: GeneratorPage): boolean {
  const { canonicalUrl, normalisedUrl } = page.record;
  return canonicalUrl !== null && canonicalKey(canonicalUrl) === canonicalKey(normalisedUrl);
}

export function homepageOf(pages: readonly GeneratorPage[]): GeneratorPage | undefined {
  return pages.find((page) => page.crawlSignals.crawlDepth === 0) ?? pages.find((page) => page.record.pageType === 'home');
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
 * The section names of a selection in the order they are rendered: the page-type
 * sections in their fixed order, then the site's areas with the highest-scoring first,
 * then Pages, then Optional.
 */
export function sectionNamesInOrder(selected: readonly SelectedPage[]): string[] {
  return orderSectionNames(selected.map((entry) => entry.sectionName));
}

/** `names` holds each section's name at least once, areas in the order their best pages rank. */
function orderSectionNames(names: readonly string[]): string[] {
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
function sectionNameOf(
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

function sectionLimitOf(sectionName: string, limits: SelectionLimits): number {
  if (sectionName === OPTIONAL_SECTION_NAME) return limits.maxOptionalEntries;
  if (sectionName === SECTION_NAMES.blog) return limits.maxBlogEntries;
  return isDocumentationSection(sectionName) ? limits.maxDocumentationEntriesPerSection : limits.maxEntriesPerSection;
}

function isDocumentationSection(sectionName: string): boolean {
  return [SECTION_NAMES.docs, SECTION_NAMES.api, SECTION_NAMES.guide].includes(sectionName);
}

/**
 * Sections for the areas of a site that no page type covers: when at least
 * MINIMUM_PAGES_IN_AREA_SECTION pages of type `other` share a first path segment
 * (`/community/...`), they get a section named after it. The name is the navigation's
 * label for the area's own page (`/community`) when there is one, else the segment in
 * title case. Keyed by segment.
 */
function areaSectionNamesOf(
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

/** `success-stories` -> `Success Stories`. */
export function titleCaseOf(slug: string): string {
  return slug
    .replace(/[-_+\s]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** `/blog/page/2`, `?page=3`, `?p=4`: listing pages, not content. */
export function isPaginationUrl(url: string): boolean {
  const parsed = new URL(url);
  if (/\/page\/\d+\/?$/.test(parsed.pathname)) return true;
  return ['page', 'p', 'paged'].some((name) => /^\d+$/.test(parsed.searchParams.get(name) ?? ''));
}

/**
 * The homepage's language, else the most common one. Pages that declare a different
 * primary language (`/de/...` on an English site) are locale duplicates and are left out.
 */
function primaryLanguageOf(pages: readonly GeneratorPage[]): string | null {
  const homepage = pages.find((page) => page.record.pageType === 'home' || page.crawlSignals.crawlDepth === 0);
  const homepageLanguage = primarySubtag(homepage?.record.languageCode ?? null);
  if (homepageLanguage !== null) return homepageLanguage;
  const counts = new Map<string, number>();
  for (const page of pages) {
    const language = primarySubtag(page.record.languageCode);
    if (language !== null) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  return ranked[0]?.[0] ?? null;
}

function isOtherLanguage(page: GeneratorPage, siteLanguage: string | null): boolean {
  const language = primarySubtag(page.record.languageCode);
  return siteLanguage !== null && language !== null && language !== siteLanguage;
}

function primarySubtag(languageCode: string | null): string | null {
  const subtag = languageCode?.split(/[-_]/)[0]?.trim().toLowerCase();
  return subtag ? subtag : null;
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

/** Enough normalisation to match a declared canonical URL against a row's normalised URL. */
function canonicalKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    const href = parsed.href;
    return parsed.pathname === '/' && parsed.search === '' ? href.replace(/\/$/, '') : href;
  } catch {
    return url;
  }
}

/**
 * Orders text with runs of digits compared as numbers, so `/posts/2` comes before
 * `/posts/10`. Locale-independent, so the output does not depend on the machine.
 */
export function compareText(a: string, b: string): number {
  const aParts = a.match(/\d+|\D+/g) ?? [];
  const bParts = b.match(/\d+|\D+/g) ?? [];
  for (let index = 0; index < Math.min(aParts.length, bParts.length); index += 1) {
    const aPart = aParts[index]!;
    const bPart = bParts[index]!;
    if (aPart === bPart) continue;
    const bothNumeric = /^\d/.test(aPart) && /^\d/.test(bPart);
    if (bothNumeric && aPart.length !== bPart.length) {
      const difference = Number(aPart) - Number(bPart);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    }
    return aPart < bPart ? -1 : 1;
  }
  return aParts.length - bParts.length || (a < b ? -1 : a > b ? 1 : 0);
}
