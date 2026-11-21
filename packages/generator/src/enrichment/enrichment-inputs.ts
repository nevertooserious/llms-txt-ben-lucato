import { createHash } from 'node:crypto';
import type { GeneratorPage } from '@llms-txt/contracts';
import { buildEntryTextContext, crawledDescriptionOf, entryTitle } from '../entry-text';
import { homepageOf, listingCandidates, OPTIONAL_SECTION_NAME, selectPages } from '../selection';
import { PAGE_ASSESSMENT_MODEL, SITE_SUMMARY_MODEL, type PageAssessmentInput, type SiteSummaryInput } from './llm-client';
import { PAGE_ASSESSMENT_PROMPT_VERSION, SITE_SUMMARY_PROMPT_VERSION } from './prompts';

// What each LLM call is given, and the hash of those inputs that its result is cached against.

export function pageAssessmentInputOf(page: GeneratorPage): PageAssessmentInput {
  return {
    url: page.record.normalisedUrl,
    title: page.record.title,
    metaDescription: page.record.description,
    urlBasedPageType: page.record.pageType,
    contentMarkdown: page.record.contentMarkdown,
  };
}

/** Changes when the page's content, the model or the prompt does. */
export function pageAssessmentSourceHash(page: GeneratorPage): string {
  return sha256([
    PAGE_ASSESSMENT_MODEL,
    PAGE_ASSESSMENT_PROMPT_VERSION,
    page.record.normalisedUrl,
    page.record.title,
    page.record.description,
    page.record.pageType,
    page.record.contentDigest,
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
  const navigationTitles = selectPages(pages, [])
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
  ]);
}

export function buildSiteSummaryInput(
  siteTitle: string,
  pages: readonly GeneratorPage[],
  previous: { summary: string | null; notes: string[] },
): SiteSummaryInput {
  const homepage = homepageOf(pages);
  const context = buildEntryTextContext(siteTitle, pages);
  return {
    siteTitle,
    homepageDescription: homepage?.record.description ?? null,
    homepageContentMarkdown: homepage?.record.contentMarkdown ?? '',
    listedPages: selectPages(pages, [])
      .filter((entry) => entry.sectionName !== OPTIONAL_SECTION_NAME)
      .map((entry) => ({
        title: entryTitle(entry.page, siteTitle),
        description: entry.page.assessment?.description ?? (crawledDescriptionOf(entry.page, context) || null),
        sectionName: entry.sectionName,
      })),
    previousSummary: previous.summary,
    previousNotes: previous.notes,
  };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
