import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf } from '../selection';
import { firstParagraphOf } from './entry-descriptions';
import { normaliseForComparison, singleLine } from './text';
import { lastTitlePartOf, MINIMUM_PAGES_SHARING_SITE_NAME } from './title-parts';

/** Text on this many pages with different content is the template's, not any one page's. */
const MINIMUM_PAGES_SHARING_BOILERPLATE = 3;

/** What the pages of a site share, worked out once per render. */
export interface EntryTextContext {
  siteTitle: string;
  /** The homepage's own title, which some sites repeat as every page's og:title. */
  homepageTitle: string;
  /** Normalised descriptions that say nothing about the page they are on. */
  boilerplateDescriptions: ReadonlySet<string>;
  /** Normalised opening paragraphs that several pages share, such as a cookie notice. */
  boilerplateParagraphs: ReadonlySet<string>;
  /** Names that titles end with across the site (`| Acme`, `| Acme Foundation`), longest first. */
  titleSuffixes: readonly string[];
}

export function buildEntryTextContext(siteTitle: string, pages: readonly GeneratorPage[]): EntryTextContext {
  const homepage = homepageOf(pages);
  const boilerplateDescriptions = textsOnSeveralPages(pages, (page) => page.record.description);
  const homepageDescription = normaliseForComparison(homepage?.record.description ?? '');
  if (homepageDescription !== '') boilerplateDescriptions.add(homepageDescription);

  const suffixes = textsOnSeveralPages(
    pages,
    (page) => lastTitlePartOf(singleLine(page.record.title ?? '')),
    MINIMUM_PAGES_SHARING_SITE_NAME,
    false,
  );
  if (siteTitle !== '') suffixes.add(siteTitle);

  return {
    siteTitle,
    homepageTitle: singleLine(homepage?.record.title ?? ''),
    boilerplateDescriptions,
    boilerplateParagraphs: textsOnSeveralPages(pages, (page) => firstParagraphOf(page.record.contentMarkdown)),
    titleSuffixes: [...suffixes].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)),
  };
}

/**
 * Texts that at least `minimumPages` pages with different content carry. Counting
 * distinct content keeps copies of one page (`/a` and `/a?ref=x`) from making its own
 * text look like boilerplate.
 */
function textsOnSeveralPages(
  pages: readonly GeneratorPage[],
  textOf: (page: GeneratorPage) => string | null,
  minimumPages = MINIMUM_PAGES_SHARING_BOILERPLATE,
  normalise = true,
): Set<string> {
  const contentDigestsByText = new Map<string, Set<string>>();
  for (const page of pages) {
    const text = textOf(page);
    const key = text === null ? '' : normalise ? normaliseForComparison(text) : text;
    if (key === '') continue;
    let contentDigests = contentDigestsByText.get(key);
    if (contentDigests === undefined) contentDigestsByText.set(key, (contentDigests = new Set()));
    contentDigests.add(page.record.contentDigest);
  }
  return new Set(
    [...contentDigestsByText]
      .filter(([, contentDigests]) => contentDigests.size >= minimumPages)
      .map(([text]) => text),
  );
}
