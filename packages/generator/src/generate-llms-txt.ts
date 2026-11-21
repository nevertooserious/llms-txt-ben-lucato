import type { GeneratorPage, PageType, WorkspacePageOverride } from '@llms-txt/contracts';

/** The only LLM calls the generator makes. Results are cached by the caller. */
export interface LlmClient {
  writeSiteSummary(input: { siteTitle: string; pages: GeneratorPage[] }): Promise<string>;
  writePageDescription(input: { title: string; contentMarkdown: string }): Promise<string>;
}

export interface GenerateLlmsTxtInput {
  siteTitle: string;
  /** Cached site summary; written by the LLM only when its inputs change. */
  siteSummary: string | null;
  pages: GeneratorPage[];
  overrides: WorkspacePageOverride[];
}

// STUB. A placeholder renderer so a run can go end to end (submit, crawl, publish,
// show in the UI) before the real generator lands. It applies overrides, leaves out
// noindex pages, groups by page type and puts deep pages under `Optional`, but has no
// scoring, no duplicate handling and no LLM. The real rules are in
// docs/design/README.md sections 2 and 8, and the todos in generate-llms-txt.test.ts.

const SECTION_TITLES: Record<PageType, string> = {
  home: 'Overview',
  docs: 'Docs',
  api: 'API',
  guide: 'Guides',
  product: 'Product',
  pricing: 'Pricing',
  about: 'About',
  blog: 'Blog',
  legal: 'Legal',
  other: 'Pages',
};
const SECTION_ORDER = Object.keys(SECTION_TITLES) as PageType[];
/** Pages deeper than this go under Optional. */
const OPTIONAL_BELOW_CRAWL_DEPTH = 2;

/** Deterministic: the same input always renders the same text. */
export function generateLlmsTxt(input: GenerateLlmsTxtInput): string {
  const overrides = new Map(input.overrides.map((override) => [override.normalisedUrl, override]));
  const sections = new Map<string, string[]>();

  const listed = input.pages
    .filter((page) => !page.crawlSignals.hasNoindexDirective && !overrides.get(page.record.normalisedUrl)?.isExcluded)
    .sort((a, b) => a.record.normalisedUrl.localeCompare(b.record.normalisedUrl));
  for (const page of listed) {
    const isOptional = page.crawlSignals.crawlDepth > OPTIONAL_BELOW_CRAWL_DEPTH || page.record.pageType === 'legal';
    const section = isOptional ? 'Optional' : SECTION_TITLES[page.record.pageType];
    const description = overrides.get(page.record.normalisedUrl)?.descriptionOverride ?? page.record.description;
    const entries = sections.get(section) ?? [];
    entries.push(renderEntry(page.record.title ?? page.record.normalisedUrl, linkFor(page), description));
    sections.set(section, entries);
  }

  const lines = [`# ${oneLine(input.siteTitle)}`, ''];
  if (input.siteSummary) lines.push(`> ${oneLine(input.siteSummary)}`, '');
  for (const section of [...SECTION_ORDER.map((type) => SECTION_TITLES[type]), 'Optional']) {
    const entries = sections.get(section);
    if (entries) lines.push(`## ${section}`, '', ...entries, '');
  }
  return lines.join('\n');
}

function linkFor(page: GeneratorPage): string {
  return page.markdownVariantUrl ?? page.record.canonicalUrl ?? page.record.normalisedUrl;
}

function renderEntry(title: string, url: string, description: string | null): string {
  const link = `- [${oneLine(title).replace(/[[\]\\]/g, '\\$&')}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  const text = description === null ? '' : oneLine(description);
  return text === '' ? link : `${link}: ${text}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
