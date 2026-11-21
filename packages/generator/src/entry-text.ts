import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf, titleCaseOf } from './select-pages';

// The words of the file that come from the crawl rather than from an LLM or a user: the
// site's name, and each entry's title and description. A site's templates repeat text
// on every page (a site-wide meta description, the site name in every title), and what
// a page shares with the rest of the site says nothing about that page. So these
// functions look at all the pages together. Pure and deterministic.

/** Descriptions are cut to this length at a word boundary, so an entry stays one readable line. */
const MAXIMUM_DESCRIPTION_LENGTH = 300;
/** What sites put between a page's name and the site's name in a title. */
const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' · ', ' :: '];
/** One other page sharing part of a title could be chance; two look like a template. */
const MINIMUM_PAGES_SHARING_SITE_NAME = 2;
/** Text on this many pages with different content is the template's, not any one page's. */
const MINIMUM_PAGES_SHARING_BOILERPLATE = 3;
/** A longer title is a headline or a sentence, not a name. */
const MAXIMUM_TITLE_LENGTH = 80;
/** A description of fewer words that is not even a sentence is a label left in a template. */
const MINIMUM_FRAGMENT_DESCRIPTION_WORDS = 4;
/** A paragraph shorter than this is a caption or a byline. */
const MINIMUM_PARAGRAPH_LENGTH = 50;
/** A description taken from the content stops at the sentence that passes this length. */
const PREFERRED_PARAGRAPH_DESCRIPTION_LENGTH = 200;

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

// --- site name -----------------------------------------------------------------------

/**
 * The site's name. First what the homepage declares (og:site_name and the like). Else
 * from a homepage title that may also carry a tagline or page name (`The guide – Acme`):
 * the part at either end that at least MINIMUM_PAGES_SHARING_SITE_NAME other pages carry
 * too. Else the name most other pages' titles end or start with, when at least half do
 * (`Welcome to Acme` with pages titled `Docs | Acme`). Otherwise the title is kept.
 */
export function siteNameFrom(homepageTitle: string, pages: readonly GeneratorPage[]): string {
  const declaredSiteName = singleLine(homepageOf(pages)?.record.declaredSiteName ?? '');
  if (declaredSiteName !== '') return declaredSiteName;

  const title = singleLine(homepageTitle);
  const otherTitles = pages
    .filter((page) => page.crawlSignals.crawlDepth > 0)
    .map((page) => singleLine(page.record.title ?? ''))
    .filter((pageTitle) => pageTitle !== '' && pageTitle !== title);

  let siteName = title;
  let mostPagesSharing = MINIMUM_PAGES_SHARING_SITE_NAME - 1;
  for (const separator of TITLE_SEPARATORS) {
    if (!title.includes(separator)) continue;
    const lastPart = title.slice(title.lastIndexOf(separator) + separator.length).trim();
    const firstPart = title.slice(0, title.indexOf(separator)).trim();
    for (const candidate of [lastPart, firstPart]) {
      if (candidate === '') continue;
      const pagesSharing = otherTitles.filter((pageTitle) => carriesSiteName(pageTitle, candidate)).length;
      if (pagesSharing > mostPagesSharing) {
        siteName = candidate;
        mostPagesSharing = pagesSharing;
      }
    }
  }
  if (siteName !== title) return siteName;

  const pagesByTitleEnd = new Map<string, number>();
  for (const pageTitle of otherTitles) {
    for (const part of new Set([lastTitlePartOf(pageTitle), firstTitlePartOf(pageTitle)])) {
      if (part !== null) pagesByTitleEnd.set(part, (pagesByTitleEnd.get(part) ?? 0) + 1);
    }
  }
  const [mostCommon] = [...pagesByTitleEnd].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const pagesNeeded = Math.max(MINIMUM_PAGES_SHARING_SITE_NAME, otherTitles.length / 2);
  return mostCommon !== undefined && mostCommon[1] >= pagesNeeded ? mostCommon[0] : title;
}

function carriesSiteName(title: string, siteName: string): boolean {
  return TITLE_SEPARATORS.some(
    (separator) => title.endsWith(`${separator}${siteName}`) || title.startsWith(`${siteName}${separator}`),
  );
}

/** `Acme` in `Docs | Acme`; null for a title with no separator. */
function lastTitlePartOf(title: string): string | null {
  const partStart = Math.max(
    ...TITLE_SEPARATORS.map((separator) => {
      const index = title.lastIndexOf(separator);
      return index === -1 ? -1 : index + separator.length;
    }),
  );
  const part = partStart === -1 ? '' : title.slice(partStart).trim();
  return part === '' ? null : part;
}

function firstTitlePartOf(title: string): string | null {
  const partEnds = TITLE_SEPARATORS.map((separator) => title.indexOf(separator)).filter((index) => index !== -1);
  const part = partEnds.length === 0 ? '' : title.slice(0, Math.min(...partEnds)).trim();
  return part === '' ? null : part;
}

// --- titles ----------------------------------------------------------------------------

/**
 * The page's title without the site name most sites add (`Docs | Acme`, `Acme | Docs`). A
 * page with no title, or titled only with the site name, gets one from the URL's last
 * path segment.
 */
export function entryTitle(page: GeneratorPage, siteTitle: string): string {
  return ownTitleOf(page, { siteTitle, homepageTitle: '', titleSuffixes: siteTitle === '' ? [] : [siteTitle] }) ?? titleFromUrl(page);
}

/**
 * The entry's title: the page's own, without the names the site's titles end with. When
 * that is missing, or is a headline or a sentence rather than a name, the text of the
 * navigation link to the page, then a title made from the URL.
 */
export function entryTitleIn(page: GeneratorPage, context: EntryTextContext): string {
  const ownTitle = ownTitleOf(page, context);
  if (ownTitle !== null && !looksLikeSentence(ownTitle)) return ownTitle;
  return alternativeTitlesOf(page)[0] ?? ownTitle ?? titleFromUrl(page);
}

/** Other names for the page, best first, for when its title is unusable or already taken. */
export function alternativeTitlesOf(page: GeneratorPage): string[] {
  const navigationLabel = singleLine(page.crawlSignals.navigationLabel ?? '');
  const lastSegment = lastPathSegmentOf(page);
  // A number or an identifier is not a name.
  const fromUrl = /\p{L}{3}/u.test(lastSegment) ? [titleFromUrl(page)] : [];
  return navigationLabel === '' ? fromUrl : [navigationLabel, ...fromUrl];
}

/** The page's title with site names removed, or null when nothing of its own is left. */
function ownTitleOf(
  page: GeneratorPage,
  context: Pick<EntryTextContext, 'siteTitle' | 'homepageTitle' | 'titleSuffixes'>,
): string | null {
  let title = singleLine(page.record.title ?? '');
  // A page on another host of the site may end its title with that host (`| docs.acme.com`).
  const names = [...context.titleSuffixes, new URL(page.record.normalisedUrl).hostname];
  // Twice, for `Page | Area | Site`.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const separator of TITLE_SEPARATORS) {
      for (const name of names) {
        const suffix = `${separator}${name}`;
        if (title.length > suffix.length && title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      }
      const prefix = `${context.siteTitle}${separator}`;
      if (context.siteTitle !== '' && title.length > prefix.length && title.startsWith(prefix)) {
        title = title.slice(prefix.length).trim();
      }
    }
  }
  const isOnlyTheSiteName = title === context.siteTitle || title === context.homepageTitle;
  return title === '' || isOnlyTheSiteName ? null : title;
}

function looksLikeSentence(title: string): boolean {
  return title.length > MAXIMUM_TITLE_LENGTH || /[.!]$/.test(title);
}

function titleFromUrl(page: GeneratorPage): string {
  const words = titleCaseOf(lastPathSegmentOf(page).replace(/\.[a-z0-9]+$/i, ''));
  return words === '' ? new URL(page.record.normalisedUrl).host : words;
}

function lastPathSegmentOf(page: GeneratorPage): string {
  const lastSegment = new URL(page.record.normalisedUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

// --- descriptions ----------------------------------------------------------------------

/**
 * A description for the page from what was crawled: its meta description, unless that
 * is the site's boilerplate or a fragment of a few words; else the opening paragraph of
 * its content, on the same terms. Empty when neither will do: no description is better
 * than one that is the same on every line.
 */
export function crawledDescriptionOf(page: GeneratorPage, context: EntryTextContext): string {
  const description = singleLine(page.record.description ?? '');
  if (saysSomething(description) && !context.boilerplateDescriptions.has(normaliseForComparison(description))) {
    return description;
  }
  const paragraph = firstParagraphOf(page.record.contentMarkdown);
  if (paragraph === null) return '';
  const key = normaliseForComparison(paragraph);
  return context.boilerplateParagraphs.has(key) || context.boilerplateDescriptions.has(key) ? '' : paragraph;
}

/** `Start here.` says something; `Inline image sizing` is a fragment that says nothing. */
function saysSomething(description: string): boolean {
  if (description === '') return false;
  const words = description.split(' ').filter((word) => word !== '');
  const endsAsSentence = /[.!?。！？]["'”’)]?$/.test(description);
  // Scripts written without spaces have no words to count.
  const hasNoSpaces = words.length === 1 && description.length >= 10;
  return endsAsSentence || hasNoSpaces || words.length >= MINIMUM_FRAGMENT_DESCRIPTION_WORDS;
}

/**
 * The first block of the content that is a paragraph of prose: not a heading, list,
 * table, quote or code, mostly its own words rather than links, not a quotation, and
 * ending as a sentence does. Cut after the sentence that passes PREFERRED_PARAGRAPH_DESCRIPTION_LENGTH.
 */
export function firstParagraphOf(contentMarkdown: string): string | null {
  let isInCodeBlock = false;
  for (const block of contentMarkdown.split(/\n\s*\n/)) {
    const startsFence = /^\s*(```|~~~)/.test(block);
    const fenceCount = (block.match(/^\s*(```|~~~)/gm) ?? []).length;
    if (isInCodeBlock || startsFence) {
      if (fenceCount % 2 === 1) isInCodeBlock = !isInCodeBlock;
      continue;
    }
    if (/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||!\[)/.test(block)) continue;
    const linkText = [...block.matchAll(/\[([^\]]*)\]\([^)]*\)/g)].map((match) => match[1]!).join('');
    const text = singleLine(
      block
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]+/g, '')
        .replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1'),
    );
    if (text.length < MINIMUM_PARAGRAPH_LENGTH || linkText.length * 2 > text.length) continue;
    // A paragraph that opens with a quotation mark is someone's words about the page's
    // subject, and one that opens with a dash says whose they were.
    if (/^(?:["“«‘]|--|[—–])/.test(text)) continue;
    if (!/[.!?。！？]["'”’)]?$/.test(text)) continue;
    return leadingSentencesOf(text);
  }
  return null;
}

function leadingSentencesOf(text: string): string {
  if (text.length <= PREFERRED_PARAGRAPH_DESCRIPTION_LENGTH) return text;
  const sentenceEnd = /[.!?。！？]["'”’)]?(?=\s|$)/g;
  for (let match = sentenceEnd.exec(text); match !== null; match = sentenceEnd.exec(text)) {
    const end = match.index + match[0].length;
    if (end >= PREFERRED_PARAGRAPH_DESCRIPTION_LENGTH) return text.slice(0, end);
  }
  return text;
}

// --- text helpers ----------------------------------------------------------------------

/** Collapses whitespace, newlines included, so text cannot break out of its line. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string): string {
  if (text.length <= MAXIMUM_DESCRIPTION_LENGTH) return text;
  const cut = text.slice(0, MAXIMUM_DESCRIPTION_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAXIMUM_DESCRIPTION_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Case, whitespace and closing punctuation do not make two texts different. */
export function normaliseForComparison(text: string): string {
  return singleLine(text).toLowerCase().replace(/[.!?…]+$/, '');
}
