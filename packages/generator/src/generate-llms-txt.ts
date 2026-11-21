import type { GeneratorPage, WorkspacePageOverride } from '@llms-txt/contracts';
import {
  alternativeTitlesOf,
  buildEntryTextContext,
  crawledDescriptionOf,
  entryTitleIn,
  normaliseForComparison,
  singleLine,
  truncate,
  type EntryTextContext,
} from './entry-text';
import {
  DEFAULT_SELECTION_LIMITS,
  homepageOf,
  sectionNamesInOrder,
  selectPages,
  type SelectedPage,
  type SelectionLimits,
} from './select-pages';
import { validateLlmsTxt } from './validate-llms-txt';

export { entryTitle, siteNameFrom } from './entry-text';

export interface GenerateLlmsTxtInput {
  siteTitle: string;
  /** Cached site summary; written by the LLM only when its inputs change. Null falls back to the homepage's description. */
  siteSummary: string | null;
  pages: GeneratorPage[];
  overrides: WorkspacePageOverride[];
  limits?: SelectionLimits;
}

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
  const context = buildEntryTextContext(siteTitle, input.pages);
  const titles = entryTitlesOf(selected, context);

  const blocks: string[] = [`# ${siteTitle || 'Untitled site'}`];
  if (summary !== '') blocks.push(`> ${summary}`);
  for (const sectionName of sectionNamesInOrder(selected)) {
    const entries = selected.filter((entry) => entry.sectionName === sectionName);
    blocks.push(
      `## ${sectionName}`,
      entries.map((entry) => renderEntry(entry, titles.get(entry.page.record.normalisedUrl)!, context)).join('\n'),
    );
  }
  const llmsTxt = `${blocks.join('\n\n')}\n`;

  const validation = validateLlmsTxt(llmsTxt);
  if (!validation.isValid) throw new Error(`generated llms.txt breaks the spec: ${validation.problems.join('; ')}`);
  return llmsTxt;
}

/**
 * A title for every listed page, keyed by URL. Two entries with one title cannot be
 * told apart, so of pages that share one, the highest-scoring keeps it and the others
 * take the navigation's label for them or a title from their URL, when that is free.
 */
function entryTitlesOf(selected: readonly SelectedPage[], context: EntryTextContext): Map<string, string> {
  const titles = new Map<string, string>();
  const taken = new Set<string>();
  for (const { page } of selected) {
    let title = entryTitleIn(page, context);
    if (taken.has(title)) title = alternativeTitlesOf(page).find((alternative) => !taken.has(alternative)) ?? title;
    taken.add(title);
    titles.set(page.record.normalisedUrl, title);
  }
  return titles;
}

function renderEntry(entry: SelectedPage, title: string, context: EntryTextContext): string {
  const { page } = entry;
  const url = encodeEntryUrl(page.markdownVariantUrl ?? page.fetchUrl);
  let description = truncate(
    singleLine(entry.descriptionOverride ?? page.assessment?.description ?? crawledDescriptionOf(page, context)),
  );
  // A description that only repeats the title adds nothing to the line.
  if (normaliseForComparison(description) === normaliseForComparison(title)) description = '';
  return `- [${escapeTitle(title)}](${url})${description === '' ? '' : `: ${description}`}`;
}

function escapeTitle(title: string): string {
  return title.replace(/[\\[\]]/g, (character) => `\\${character}`);
}

/** Parentheses and whitespace would end the markdown link early. */
function encodeEntryUrl(url: string): string {
  return url.replace(/[()\s]/g, (character) => encodeURIComponent(character).replace('(', '%28').replace(')', '%29'));
}
