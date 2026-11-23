import { fragmentRoutePathOf, type GeneratorPage, type PageOverride } from '@llms-txt/contracts';
import { pagesCoveredByBroaderPage } from './broader-pages';
import { postsLinkedByHomepage } from './homepage-posts';
import { listingCandidates } from './listing-candidates';
import { homepageOf } from './page-kinds';
import { withoutReferenceFamilies } from './reference-families';
import { pagesSampledFromListedIndex } from './sampled-pages';
import { pagesBeyondAddressFamilySample, pagesBeyondTemplateFamilySample } from './template-families';
import { scorePage } from './score-page';
import { areaSectionNamesOf, SECTION_NAMES, sectionNameOf } from './sections';
import { canonicalKey, compareText } from './url-paths';

export interface SelectedPage {
  page: GeneratorPage;
  score: number;
  /** A name from SECTION_NAMES, an area's name, GENERAL_SECTION_NAME or OPTIONAL_SECTION_NAME. */
  sectionName: string;
  descriptionOverride: string | null;
}

/**
 * A page is listed because it was judged useful, not because of how it ranks: there is no
 * limit on entries and no minimum score. Takes the listing candidates, minus pages not
 * assessed yet, pages the user excluded and pages the assessment judged not useful, minus
 * the rest of a folder most of whose pages are reference entries; keeps one page per
 * canonical URL; and drops narrow pages that a listed broader page stands for, and pages
 * that are a sample of the many a listed index page links, and all but a few of the pages
 * a site builds from one template. On a blog, the posts its
 * homepage links are listed although the assessment leaves single posts out, under Blog. The score
 * only orders the entries of a section. Pages that score the same keep the order of the
 * site's navigation, then the order the crawl first saw links to them, then of their
 * URLs. An assessment's page type replaces the extractor's. A page the user keeps passes
 * every one of these rules; only their exclusion removes it.
 */
export function selectPages(pages: readonly GeneratorPage[], overrides: readonly PageOverride[]): SelectedPage[] {
  const overridesByUrl = new Map(overrides.map((override) => [override.normalisedUrl, override]));
  const isKept = (page: GeneratorPage) => overridesByUrl.get(page.record.normalisedUrl)?.isKept === true;

  const homepagePosts = new Set(postsLinkedByHomepage(pages));
  const assessedCandidates = listingCandidates(pages).filter(
    (page) =>
      page.assessment !== null &&
      (page.assessment.listingValue !== 'exclude' || isKept(page) || homepagePosts.has(page)) &&
      overridesByUrl.get(page.record.normalisedUrl)?.isExcluded !== true,
  );
  const outsideReferenceFamilies = new Set(withoutReferenceFamilies(assessedCandidates, pages));
  const candidates = keepOnePerCanonicalUrl(
    assessedCandidates.filter((page) => outsideReferenceFamilies.has(page) || isKept(page)),
  );
  const coveredPages = new Set(
    [...pagesCoveredByBroaderPage(candidates), ...pagesSampledFromListedIndex(candidates, pages)].filter(
      (page) => !isKept(page),
    ),
  );
  const allRanked = candidates
    .filter((page) => !coveredPages.has(page))
    .map((page) => ({ page, score: scorePage(page) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        navigationOrderOf(a.page) - navigationOrderOf(b.page) ||
        linkOrderOf(a.page) - linkOrderOf(b.page) ||
        compareText(a.page.record.normalisedUrl, b.page.record.normalisedUrl),
    );
  const rankedPages = allRanked.map((entry) => entry.page);
  const beyondFamilySample = new Set([
    ...pagesBeyondTemplateFamilySample(rankedPages),
    ...pagesBeyondAddressFamilySample(rankedPages),
  ]);
  const ranked = allRanked.filter((entry) => !beyondFamilySample.has(entry.page) || isKept(entry.page));
  const homepage = homepageOf(pages);
  const areaSectionNames = areaSectionNamesOf(
    ranked.map((entry) => entry.page).filter((page) => !homepagePosts.has(page)),
    candidates,
    homepage,
  );
  return ranked.map(({ page, score }) => ({
    page,
    score,
    // A post is a post, whatever type the model gave the page it is on.
    sectionName: homepagePosts.has(page) ? SECTION_NAMES.blog : sectionNameOf(page, areaSectionNames, homepage),
    descriptionOverride: overridesByUrl.get(page.record.normalisedUrl)?.descriptionOverride ?? null,
  }));
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
 * otherwise the highest-scoring one. A route in the URL fragment is its own page whatever
 * it declares: every route is the same document, which can name only one canonical URL.
 */
function keepOnePerCanonicalUrl(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const byCanonical = new Map<string, GeneratorPage>();
  for (const page of pages) {
    const isFragmentRoute = fragmentRoutePathOf(new URL(page.record.normalisedUrl)) !== '';
    const key = isFragmentRoute
      ? page.record.normalisedUrl
      : canonicalKey(page.record.canonicalUrl ?? page.record.normalisedUrl);
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
