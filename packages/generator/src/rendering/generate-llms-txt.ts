import {
  MACHINE_READABLE_RESOURCE_KINDS,
  machineReadableResourceKindOf,
  type GeneratorPage,
  type MachineReadableResourceKind,
  type PageOverride,
} from '@llms-txt/contracts';
import {
  alternativeTitlesOf,
  buildNamingContext,
  entryTitleIn,
  homepageEntryTitleIn,
  type NamingContext,
} from '../naming';
import { normaliseForComparison, singleLine, truncate } from '../text/normalise-text';
import {
  GENERAL_SECTION_NAME,
  homepageOf,
  OPTIONAL_SECTION_NAME,
  sectionNamesInOrder,
  selectPages,
  type SelectedPage,
} from '../selection';
import { validateLlmsTxt } from './validate-llms-txt';

export interface GenerateLlmsTxtInput {
  siteTitle: string;
  /** Cached site summary; written by the LLM only when its inputs change. Null falls back to the homepage's description. */
  siteSummary: string | null;
  /** Cached with the summary: one line each, for what the links cannot say. Usually none. */
  siteNotes?: readonly string[];
  /** The site's own files for machines (llms-full.txt and other versions of it, a section's llms.txt, an OpenAPI description). */
  machineReadableResourceUrls?: readonly string[];
  pages: GeneratorPage[];
  overrides: PageOverride[];
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
 *   - [Home](markdown url): description     (only when the homepage has a markdown file)
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
  const selected = selectPages(input.pages, input.overrides);
  const context = buildNamingContext(siteTitle, input.pages);
  const homepageEntry = homepageEntryOf(input, context, summary);
  const titles = entryTitlesOf(selected, context, homepageEntry === null ? [] : [homepageEntry.title]);

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
  if (homepageEntry !== null) {
    // First of the first section a reader should keep, whatever that section is: the
    // homepage is where the site itself starts.
    const firstSection = sections.find((section) => section.sectionName !== OPTIONAL_SECTION_NAME);
    if (firstSection !== undefined) firstSection.lines.unshift(homepageEntry.line);
    else sections.unshift({ sectionName: GENERAL_SECTION_NAME, lines: [homepageEntry.line] });
  }
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
function entryTitlesOf(
  selected: readonly SelectedPage[],
  context: NamingContext,
  takenTitles: readonly string[],
): Map<string, string> {
  const titles = new Map<string, string>();
  const taken = new Set<string>(takenTitles);
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
  const description = singleLine(entry.descriptionOverride ?? page.assessment?.description ?? '');
  return renderLine(title, page.markdownVariantUrl ?? page.fetchUrl, description);
}

function renderLine(title: string, url: string, untruncatedDescription: string): string {
  let description = truncate(untruncatedDescription);
  // A description that only repeats the title adds nothing to the line.
  if (normaliseForComparison(description) === normaliseForComparison(title)) description = '';
  return `- [${escapeTitle(title)}](${encodeEntryUrl(url)})${description === '' ? '' : `: ${description}`}`;
}

/** Said of a homepage whose own description is missing or is already the file's summary. */
const HOMEPAGE_MARKDOWN_DESCRIPTION = "The homepage's text as markdown.";

/**
 * The homepage's entry, or null when it has none. The H1 and the summary stand for the
 * homepage, so it is not listed as a page. But where the site serves its text as markdown
 * (`/index.md`), that file is often the site's main document (a specification, a
 * project's README), and nothing else in the file would lead a reader to it. Not listed
 * when the user excluded the homepage, or when another entry already links the file.
 */
function homepageEntryOf(
  input: GenerateLlmsTxtInput,
  context: NamingContext,
  summary: string,
): { title: string; line: string } | null {
  const homepage = homepageOf(input.pages);
  if (homepage === undefined || homepage.markdownVariantUrl === null) return null;
  const override = input.overrides.find((candidate) => candidate.normalisedUrl === homepage.record.normalisedUrl);
  if (override?.isExcluded === true) return null;
  const markdownUrl = homepage.markdownVariantUrl;
  if (input.pages.some((page) => page !== homepage && page.markdownVariantUrl === markdownUrl)) return null;

  const title = homepageEntryTitleIn(homepage, context);
  let description = singleLine(override?.descriptionOverride ?? homepage.record.description ?? '');
  if (description === '' || normaliseForComparison(truncate(description)) === normaliseForComparison(summary)) {
    description = HOMEPAGE_MARKDOWN_DESCRIPTION;
  }
  return { title, line: renderLine(title, markdownUrl, description) };
}

const MACHINE_READABLE_SECTION_NAME = 'Machine-readable resources';

/** Said of every file of a kind: what it is, not what this site's says, since it is not read. */
const MACHINE_READABLE_RESOURCE_DESCRIPTIONS: Record<MachineReadableResourceKind, string> = {
  llms_full_txt: "The full text of the site's pages in one file.",
  // The file's name is its title, and says which version it is (`llms-small.txt`).
  llms_text_variant: "Another version of the site's text in one file, often shorter than the full one.",
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
