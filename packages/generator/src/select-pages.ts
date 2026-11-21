import type { GeneratorPage, PageType, WorkspacePageOverride } from '@llms-txt/contracts';

// Which pages are listed, and where. Sections come from page type; the LLM never
// chooses them. Pure and deterministic: ties are broken by URL.

/** H2 sections in the order they appear, by page type. Legal pages always go under Optional. */
export const SECTION_NAMES: Record<Exclude<PageType, 'home' | 'legal'>, string> = {
  docs: 'Docs',
  api: 'API',
  guide: 'Guides',
  product: 'Product',
  pricing: 'Pricing',
  about: 'About',
  blog: 'Blog',
  other: 'Pages',
};
export const OPTIONAL_SECTION_NAME = 'Optional';

export interface SelectionLimits {
  /** Most entries in one section; the rest move to Optional. */
  maxEntriesPerSection: number;
  /** Blog posts are numerous and individually minor, so their section is smaller. */
  maxBlogEntries: number;
  /** Most entries outside Optional. */
  maxPrimaryEntries: number;
  /** Most entries under Optional; lower-scoring pages beyond it are left out. */
  maxOptionalEntries: number;
}

export const DEFAULT_SELECTION_LIMITS: SelectionLimits = {
  maxEntriesPerSection: 15,
  maxBlogEntries: 5,
  maxPrimaryEntries: 60,
  maxOptionalEntries: 40,
};

export interface SelectedPage {
  page: GeneratorPage;
  score: number;
  /** A name from SECTION_NAMES, or OPTIONAL_SECTION_NAME. */
  sectionName: string;
  descriptionOverride: string | null;
}

/**
 * How important a page looks from how the site links it: being in the navigation counts
 * most, then nearness to the homepage, then how many pages link to it. A page the site's
 * own llms.txt lists gets a lift, since the site chose it.
 */
export function scorePage(page: GeneratorPage): number {
  const signals = page.crawlSignals;
  return (
    (signals.isInSiteNavigation ? 4 : 0) +
    3 / (1 + signals.crawlDepth) +
    Math.log2(1 + signals.inboundLinkCount) +
    (signals.discoveredVia === 'existing_llms_txt' ? 2 : 0)
  );
}

/**
 * The pages that could be listed, by rules that need no LLM: not the homepage (it is the
 * H1) under any of its URLs, noindex pages, pagination, or pages in another language than
 * the site's; and one page per set of URL variants. These are the pages worth paying to
 * assess.
 */
export function listingCandidates(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const siteLanguage = primaryLanguageOf(pages);
  const homepage = homepageOf(pages);
  const homepageVariantKey = homepage === undefined ? null : urlVariantKey(homepage);
  return keepOnePerUrlVariant(
    pages.filter(
      (page) =>
        page.record.pageType !== 'home' &&
        page.crawlSignals.crawlDepth > 0 &&
        urlVariantKey(page) !== homepageVariantKey &&
        !page.crawlSignals.hasNoindexDirective &&
        !isPaginationUrl(page.record.normalisedUrl) &&
        !isOtherLanguage(page, siteLanguage),
    ),
  );
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
 * not to belong; keeps one page per canonical URL; then fills the sections in score
 * order within the limits. An assessment's page type replaces the extractor's.
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
    .sort((a, b) => b.score - a.score || compareText(a.page.record.normalisedUrl, b.page.record.normalisedUrl));

  const sectionCounts = new Map<string, number>();
  let primaryCount = 0;
  let optionalCount = 0;
  const selected: SelectedPage[] = [];
  for (const { page, score } of ranked) {
    const pageType = page.assessment?.pageType ?? page.record.pageType;
    let sectionName =
      pageType === 'legal' || pageType === 'home' || page.assessment?.listingValue === 'optional'
        ? OPTIONAL_SECTION_NAME
        : SECTION_NAMES[pageType];
    if (sectionName !== OPTIONAL_SECTION_NAME) {
      const sectionLimit = pageType === 'blog' ? limits.maxBlogEntries : limits.maxEntriesPerSection;
      const sectionCount = sectionCounts.get(sectionName) ?? 0;
      if (sectionCount >= sectionLimit || primaryCount >= limits.maxPrimaryEntries) {
        sectionName = OPTIONAL_SECTION_NAME;
      } else {
        sectionCounts.set(sectionName, sectionCount + 1);
        primaryCount += 1;
      }
    }
    if (sectionName === OPTIONAL_SECTION_NAME) {
      if (optionalCount >= limits.maxOptionalEntries) continue;
      optionalCount += 1;
    }
    selected.push({
      page,
      score,
      sectionName,
      descriptionOverride: overridesByUrl.get(page.record.normalisedUrl)?.descriptionOverride ?? null,
    });
  }
  return selected;
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
