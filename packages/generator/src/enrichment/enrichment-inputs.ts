import { createHash } from 'node:crypto';
import type { GeneratorPage } from '@llms-txt/contracts';
import { entryTitle } from '../naming';
import { homepageOf, listingCandidates, OPTIONAL_SECTION_NAME, selectPages, type SelectedPage } from '../selection';
import { PAGE_ASSESSMENT_MODEL, SITE_SUMMARY_MODEL, type PageAssessmentInput, type SiteSummaryInput } from './llm-client';
import { PAGE_ASSESSMENT_PROMPT_VERSION, SITE_SUMMARY_PROMPT_VERSION } from './prompts';

// What each LLM call is given, and the hash of those inputs that its result is cached against.

export function pageAssessmentInputOf(page: GeneratorPage): PageAssessmentInput {
  return {
    url: page.record.normalisedUrl,
    title: page.record.title,
    metaDescription: page.record.description,
    urlBasedPageType: page.record.pageType,
    isInSiteNavigation: page.crawlSignals.isInSiteNavigation,
    contentMarkdown: page.record.contentMarkdown,
  };
}

/** Changes when the page's content, its place in the navigation, the model or the prompt does. */
export function pageAssessmentSourceHash(page: GeneratorPage): string {
  return sha256([
    PAGE_ASSESSMENT_MODEL,
    PAGE_ASSESSMENT_PROMPT_VERSION,
    page.record.normalisedUrl,
    page.record.title,
    page.record.description,
    page.record.pageType,
    page.record.contentDigest,
    page.crawlSignals.isInSiteNavigation,
  ]);
}

/** The listing candidates with no assessment, or one made from different inputs. */
export function pagesToAssess(pages: readonly GeneratorPage[]): GeneratorPage[] {
  return listingCandidates(pages).filter((page) => page.assessment?.sourceHash !== pageAssessmentSourceHash(page));
}

/**
 * Narrow on purpose: the homepage and the titles of listed navigation pages. A new blog
 * post or a reworded page leaves it alone, so the summary is not rewritten for them.
 */
export function siteSummarySourceHash(siteTitle: string, pages: readonly GeneratorPage[]): string {
  const homepage = homepageOf(pages);
  const selected = selectPages(pages, []);
  const navigationTitles = selected
    .filter((entry) => entry.page.crawlSignals.isInSiteNavigation)
    .map((entry) => entryTitle(entry.page, siteTitle))
    .sort();
  return sha256([
    SITE_SUMMARY_MODEL,
    SITE_SUMMARY_PROMPT_VERSION,
    siteTitle,
    homepage?.record.title ?? null,
    homepage?.record.description ?? null,
    navigationTitles,
    // The notes state facts from these pages, so a changed price must reach the file.
    factPagesOf(selected).map((page) => [page.record.normalisedUrl, page.record.contentDigest]),
  ]);
}

/** Most pages whose text the summary call reads besides the homepage's. */
const MAXIMUM_FACT_PAGES = 4;
const MAXIMUM_FACT_PAGE_CONTENT_LENGTH = 6_000;

/**
 * The listed pages a site's facts are on: its pricing page and its about page, then the
 * highest-ranked navigation pages that are the entry point to an area. Few, to bound what
 * the call costs, and of the navigation so that a new page elsewhere leaves the summary alone.
 */
function factPagesOf(selected: readonly SelectedPage[]): GeneratorPage[] {
  const listed = selected.filter((entry) => entry.sectionName !== OPTIONAL_SECTION_NAME).map((entry) => entry.page);
  const ofType = (pageType: string) => listed.find((page) => page.assessment?.pageType === pageType);
  const named = [ofType('pricing'), ofType('about')].filter((page) => page !== undefined);
  const broad = listed.filter(
    (page) => page.assessment?.scope === 'broad' && page.crawlSignals.isInSiteNavigation && !named.includes(page),
  );
  return [...named, ...broad].slice(0, MAXIMUM_FACT_PAGES);
}

export function buildSiteSummaryInput(
  siteTitle: string,
  pages: readonly GeneratorPage[],
  previous: { summary: string | null; notes: string[]; siteName: string | null },
): SiteSummaryInput {
  const homepage = homepageOf(pages);
  const selected = selectPages(pages, []);
  return {
    siteTitle,
    host: homepage === undefined ? '' : new URL(homepage.record.normalisedUrl).host,
    homepageDescription: homepage?.record.description ?? null,
    homepageContentMarkdown: homepage?.record.contentMarkdown ?? '',
    listedPages: selected
      .filter((entry) => entry.sectionName !== OPTIONAL_SECTION_NAME)
      .map((entry) => ({
        title: entryTitle(entry.page, siteTitle),
        description: entry.page.assessment?.description || null,
        sectionName: entry.sectionName,
      })),
    factPages: factPagesOf(selected).map((page) => ({
      title: entryTitle(page, siteTitle),
      contentMarkdown: page.record.contentMarkdown.slice(0, MAXIMUM_FACT_PAGE_CONTENT_LENGTH),
    })),
    previousSummary: previous.summary,
    previousNotes: previous.notes,
    previousSiteName: previous.siteName,
  };
}

/**
 * The name the model gave, if the site itself uses it: it must appear in the homepage's
 * text or description, the name worked out from titles, or the host. A name found
 * nowhere on the site is the model's own, and the name from titles is used instead.
 */
export function siteNameIfOnSite(siteName: string | null, input: SiteSummaryInput): string | null {
  if (siteName === null) return null;
  const lettersOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const name = lettersOf(siteName);
  if (name === '') return null;
  const siteText = [input.siteTitle, input.host, input.homepageDescription ?? '', input.homepageContentMarkdown];
  return siteText.some((text) => lettersOf(text).includes(name)) ? siteName : null;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
