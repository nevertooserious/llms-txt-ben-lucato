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
 * The page's title without the site name most sites append (`Docs | Acme`), else a
 * title made from the URL's last path segment.
 */
export function entryTitle(page: GeneratorPage, siteTitle: string): string {
  const title = singleLine(page.record.title ?? '');
  if (title !== '' && siteTitle !== '') {
    for (const separator of [' | ', ' - ', ' – ', ' — ', ' · ', ' :: ']) {
      const suffix = `${separator}${siteTitle}`;
      if (title.length > suffix.length && title.endsWith(suffix)) return title.slice(0, -suffix.length).trim();
    }
  }
  if (title !== '') return title;
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
