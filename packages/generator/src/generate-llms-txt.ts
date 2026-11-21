import type { GeneratorPage, WorkspacePageOverride } from '@llms-txt/contracts';
import {
  DEFAULT_SELECTION_LIMITS,
  homepageOf,
  OPTIONAL_SECTION_NAME,
  SECTION_NAMES,
  selectPages,
  type SelectedPage,
  type SelectionLimits,
} from './select-pages';
import { validateLlmsTxt } from './validate-llms-txt';

export interface GenerateLlmsTxtInput {
  siteTitle: string;
  /** Cached site summary; written by the LLM only when its inputs change. Null falls back to the homepage's description. */
  siteSummary: string | null;
  pages: GeneratorPage[];
  overrides: WorkspacePageOverride[];
  limits?: SelectionLimits;
}

/** Descriptions are cut to this length at a word boundary, so an entry stays one readable line. */
const MAXIMUM_DESCRIPTION_LENGTH = 300;
/** What sites put between a page's name and the site's name in a title. */
const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' · ', ' :: '];
/** One other page sharing part of a title could be chance; two look like a template. */
const MINIMUM_PAGES_SHARING_SITE_NAME = 2;

/**
 * Deterministic: the same input always renders the same text.
 *
 *   # Site title
 *
 *   > Summary
 *
 *   ## Docs
 *
 *   - [Title](url): description
 *
 *   ## Optional
 *
 *   - [Title](url): description
 *
 * Throws if the result breaks the spec (validateLlmsTxt); that would be a bug here.
 */
export function generateLlmsTxt(input: GenerateLlmsTxtInput): string {
  const siteTitle = singleLine(input.siteTitle);
  const summary = truncate(singleLine(input.siteSummary ?? homepageOf(input.pages)?.record.description ?? ''));
  const selected = selectPages(input.pages, input.overrides, input.limits ?? DEFAULT_SELECTION_LIMITS);

  const blocks: string[] = [`# ${siteTitle || 'Untitled site'}`];
  if (summary !== '') blocks.push(`> ${summary}`);
  for (const sectionName of [...Object.values(SECTION_NAMES), OPTIONAL_SECTION_NAME]) {
    const entries = selected.filter((entry) => entry.sectionName === sectionName);
    if (entries.length === 0) continue;
    blocks.push(`## ${sectionName}`, entries.map((entry) => renderEntry(entry, siteTitle)).join('\n'));
  }
  const llmsTxt = `${blocks.join('\n\n')}\n`;

  const validation = validateLlmsTxt(llmsTxt);
  if (!validation.isValid) throw new Error(`generated llms.txt breaks the spec: ${validation.problems.join('; ')}`);
  return llmsTxt;
}

function renderEntry(entry: SelectedPage, siteTitle: string): string {
  const { page } = entry;
  const title = entryTitle(page, siteTitle);
  const url = encodeEntryUrl(page.markdownVariantUrl ?? page.fetchUrl);
  const description = truncate(
    singleLine(entry.descriptionOverride ?? page.assessment?.description ?? page.record.description ?? ''),
  );
  return `- [${escapeTitle(title)}](${url})${description === '' ? '' : `: ${description}`}`;
}

/**
 * The site's name, from a homepage title that may also carry a tagline or page name
 * (`The guide – Acme`). The part at either end counts as the name only when at least
 * MINIMUM_PAGES_SHARING_SITE_NAME other pages carry it too; otherwise the title is kept.
 */
export function siteNameFrom(homepageTitle: string, pages: readonly GeneratorPage[]): string {
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
  return siteName;
}

function carriesSiteName(title: string, siteName: string): boolean {
  return TITLE_SEPARATORS.some(
    (separator) => title.endsWith(`${separator}${siteName}`) || title.startsWith(`${siteName}${separator}`),
  );
}

/**
 * The page's title without the site name most sites add (`Docs | Acme`, `Acme | Docs`). A
 * page with no title, or titled only with the site name, gets one from the URL's last
 * path segment.
 */
export function entryTitle(page: GeneratorPage, siteTitle: string): string {
  const title = singleLine(page.record.title ?? '');
  if (title !== '' && siteTitle !== '') {
    for (const separator of TITLE_SEPARATORS) {
      const suffix = `${separator}${siteTitle}`;
      if (title.length > suffix.length && title.endsWith(suffix)) return title.slice(0, -suffix.length).trim();
      const prefix = `${siteTitle}${separator}`;
      if (title.length > prefix.length && title.startsWith(prefix)) return title.slice(prefix.length).trim();
    }
  }
  if (title !== '' && title !== siteTitle) return title;
  const lastSegment = new URL(page.record.normalisedUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  const words = decodeSafely(lastSegment).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return words === '' ? new URL(page.record.normalisedUrl).host : words.charAt(0).toUpperCase() + words.slice(1);
}

/** Collapses whitespace, newlines included, so text cannot break out of its line. */
function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeTitle(title: string): string {
  return title.replace(/[\\[\]]/g, (character) => `\\${character}`);
}

/** Parentheses and whitespace would end the markdown link early. */
function encodeEntryUrl(url: string): string {
  return url.replace(/[()\s]/g, (character) => encodeURIComponent(character).replace('(', '%28').replace(')', '%29'));
}

function truncate(text: string): string {
  if (text.length <= MAXIMUM_DESCRIPTION_LENGTH) return text;
  const cut = text.slice(0, MAXIMUM_DESCRIPTION_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAXIMUM_DESCRIPTION_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function decodeSafely(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
