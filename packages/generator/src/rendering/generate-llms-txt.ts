import {
  MACHINE_READABLE_RESOURCE_KINDS,
  machineReadableResourceKindOf,
  type GeneratorPage,
  type MachineReadableResourceKind,
  type PageOverride,
} from '@llms-txt/contracts';
import {
  alternativeTitlesOf,
  buildEntryTextContext,
  entryTitleIn,
  normaliseForComparison,
  singleLine,
  truncate,
  type EntryTextContext,
} from '../entry-text';
import {
  DEFAULT_SELECTION_LIMITS,
  homepageOf,
  OPTIONAL_SECTION_NAME,
  sectionNamesInOrder,
  selectPages,
  type SelectedPage,
  type SelectionLimits,
} from '../selection';
import { validateLlmsTxt } from './validate-llms-txt';

export interface GenerateLlmsTxtInput {
  siteTitle: string;
  /** Cached site summary; written by the LLM only when its inputs change. Null falls back to the homepage's description. */
  siteSummary: string | null;
  /** Cached with the summary: one line each, for what the links cannot say. Usually none. */
  siteNotes?: readonly string[];
  /** The site's own files for machines (llms-full.txt, a section's llms.txt, an OpenAPI description). */
  machineReadableResourceUrls?: readonly string[];
  pages: GeneratorPage[];
  overrides: PageOverride[];
  limits?: SelectionLimits;
}

/**
 * Deterministic: the same input always renders the same text.
 *
 *   # Site title
 *
 *   > Summary
 *
 *   - A note
 *
 *   ## Docs
 *
 *   - [Title](url): description
 *
 *   ## Machine-readable resources
 *
 *   - [llms-full.txt](url): description
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
  const notes = (input.siteNotes ?? []).map((note) => truncate(singleLine(note))).filter((note) => note !== '');
  if (notes.length > 0) blocks.push(notes.map((note) => `- ${note}`).join('\n'));

  const sections = sectionNamesInOrder(selected).map((sectionName) => ({
    sectionName,
    lines: selected
      .filter((entry) => entry.sectionName === sectionName)
      .map((entry) => renderEntry(entry, titles.get(entry.page.record.normalisedUrl)!)),
  }));
  const resourceLines = machineReadableResourceLines(input.machineReadableResourceUrls ?? []);
  if (resourceLines.length > 0) {
    const sameName = sections.find((section) => section.sectionName === MACHINE_READABLE_SECTION_NAME);
    if (sameName !== undefined) sameName.lines.push(...resourceLines);
    else {
      // Last of what a reader should keep: Optional is what it may skip.
      const optionalIndex = sections.findIndex((section) => section.sectionName === OPTIONAL_SECTION_NAME);
      const resourceSection = { sectionName: MACHINE_READABLE_SECTION_NAME, lines: resourceLines };
      sections.splice(optionalIndex === -1 ? sections.length : optionalIndex, 0, resourceSection);
    }
  }
  for (const section of sections) blocks.push(`## ${section.sectionName}`, section.lines.join('\n'));
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

function renderEntry(entry: SelectedPage, title: string): string {
  const { page } = entry;
  const url = encodeEntryUrl(page.markdownVariantUrl ?? page.fetchUrl);
  let description = truncate(
    singleLine(entry.descriptionOverride ?? page.assessment?.description ?? ''),
  );
  // A description that only repeats the title adds nothing to the line.
  if (normaliseForComparison(description) === normaliseForComparison(title)) description = '';
  return `- [${escapeTitle(title)}](${url})${description === '' ? '' : `: ${description}`}`;
}

const MACHINE_READABLE_SECTION_NAME = 'Machine-readable resources';

/** Said of every file of a kind: what it is, not what this site's says, since it is not read. */
const MACHINE_READABLE_RESOURCE_DESCRIPTIONS: Record<MachineReadableResourceKind, string> = {
  llms_full_txt: "The full text of the site's pages in one file.",
  llms_txt_index: 'An llms.txt index for this part of the site.',
  openapi_description: 'Machine-readable OpenAPI description of the API.',
};

/** One entry per file, titled by its path (`docs/llms.txt`), kinds in a fixed order and URLs in theirs. */
function machineReadableResourceLines(urls: readonly string[]): string[] {
  const resources = [...new Set(urls)]
    .map((url) => ({ url, kind: machineReadableResourceKindOf(url) }))
    .filter((resource): resource is { url: string; kind: MachineReadableResourceKind } => resource.kind !== null)
    .sort(
      (a, b) =>
        MACHINE_READABLE_RESOURCE_KINDS.indexOf(a.kind) - MACHINE_READABLE_RESOURCE_KINDS.indexOf(b.kind) ||
        (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
    );
  return resources.map(({ url, kind }) => {
    const title = singleLine(decodedPathOf(url).replace(/^\//, ''));
    return `- [${escapeTitle(title)}](${encodeEntryUrl(url)}): ${MACHINE_READABLE_RESOURCE_DESCRIPTIONS[kind]}`;
  });
}

/** The URL's path as a reader would write it, or as it stands when its escapes are not valid. */
function decodedPathOf(url: string): string {
  const path = new URL(url).pathname;
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function escapeTitle(title: string): string {
  return title.replace(/[\\[\]]/g, (character) => `\\${character}`);
}

/** Parentheses and whitespace would end the markdown link early. */
function encodeEntryUrl(url: string): string {
  return url.replace(/[()\s]/g, (character) => encodeURIComponent(character).replace('(', '%28').replace(')', '%29'));
}
