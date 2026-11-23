import type { GeneratorPage } from '@llms-txt/contracts';
import { isDocumentationPage } from './page-kinds';
import { pagePathSegmentsOf } from './url-paths';

/** Pages built from one template are a family from this many... */
const MINIMUM_PAGES_IN_TEMPLATE_FAMILY = 8;
/** ...of which this many are listed, as examples of the rest. */
const TEMPLATE_FAMILY_PAGES_LISTED = 3;
/** The part of a title that names the one thing a templated page is about is at most this many words. */
const MAXIMUM_WORDS_THAT_VARY = 3;
/** A word in this share of the site's titles is the site's name or a separator, not part of a template. */
const SHARE_OF_TITLES_THAT_MAKES_A_WORD_BOILERPLATE = 0.8;
/** Words too common to show that two titles come from one template (`How to *`). */
const STOP_WORDS = new Set('a an and as at by for from how in is of on or the to vs what why with your'.split(' '));
/** Titles must share this many other words. */
const MINIMUM_SHARED_WORDS = 2;

/**
 * The pages of each template family beyond its first few. A site builds such pages from
 * one template, one for each place, product, model or question: `Alaska Income Tax 2026`,
 * `Arizona Income Tax 2026` and forty-eight more. An assistant learns what the family
 * holds from a few of them, and the rest crowd out the pages that differ.
 *
 * A family is told by its titles, which are the same but for a few words in one place.
 * Not by its URLs: such pages are as often spread over directories
 * (`/servers-bulgaria/sofia`, `/servers-kenya/nairobi`) as gathered in one. Words that
 * most of the site's titles carry, such as its name, do not count as shared.
 *
 * `rankedPages` are in listing order, so the pages kept are a family's best placed.
 */
export function pagesBeyondTemplateFamilySample(rankedPages: readonly GeneratorPage[]): GeneratorPage[] {
  const titled = rankedPages.filter((page) => (page.record.title ?? '').trim() !== '');
  const wordsByPage = new Map(titled.map((page, index) => [page, wordsOf(ownNamesOf(titled)[index]!)] as const));
  const boilerplate = boilerplateWordsOf([...wordsByPage.values()]);

  const familiesByTemplate = new Map<string, { pages: GeneratorPage[]; variedWords: Set<string> }>();
  for (const [page, allWords] of wordsByPage) {
    const words = allWords.filter((word) => !boilerplate.has(word));
    for (const { template, variedWords } of templatesOf(words)) {
      const family = familiesByTemplate.get(template) ?? { pages: [], variedWords: new Set<string>() };
      family.pages.push(page);
      family.variedWords.add(variedWords);
      familiesByTemplate.set(template, family);
    }
  }

  // Each page of a family names something else, or the shared words are just the site's name.
  // The largest family claims its pages first, so a page is of one family only.
  const families = [...familiesByTemplate.values()]
    .filter((family) => family.variedWords.size >= MINIMUM_PAGES_IN_TEMPLATE_FAMILY)
    .sort((a, b) => b.pages.length - a.pages.length);
  const claimed = new Set<GeneratorPage>();
  const beyondSample: GeneratorPage[] = [];
  for (const family of families) {
    const members = family.pages.filter((page) => !claimed.has(page));
    if (members.length < MINIMUM_PAGES_IN_TEMPLATE_FAMILY) continue;
    for (const page of members) claimed.add(page);
    beyondSample.push(...members.slice(TEMPLATE_FAMILY_PAGES_LISTED));
  }
  return beyondSample;
}

/** What sites put between a page's name and the site's name in a title. */
const TITLE_SEPARATOR = /\s(?:[|\-–—·•»]|::)\s/;

/**
 * Each page's own name: its title without the site's (`Docs | Acme`, `Acme - Docs`). The
 * site's name is at whichever end of the titles says the same thing on most pages.
 */
function ownNamesOf(pages: readonly GeneratorPage[]): string[] {
  const parts = pages.map((page) => (page.record.title ?? '').split(TITLE_SEPARATOR).map((part) => part.trim()));
  const distinctFirstParts = new Set(parts.map((titleParts) => titleParts[0])).size;
  const distinctLastParts = new Set(parts.map((titleParts) => titleParts.at(-1))).size;
  return parts.map((titleParts) => (distinctLastParts > distinctFirstParts ? titleParts.at(-1)! : titleParts[0]!));
}

/**
 * The same for families that titles do not show, because their pages differ in several
 * places (`eSIM for Gabon, 10 GB, 30 days`) or are titled by hand: the narrow pages of
 * one directory, or at addresses that are the same but for a few words in one place
 * (`/servers-bulgaria/sofia`, `/servers-kenya/nairobi`), when there are many. A narrow
 * page is one part of a larger area, by its assessment, so a directory of a site's
 * features or solutions, each an area of its own, is left whole. So is documentation,
 * where a directory of many narrow pages is a manual's chapters.
 */
export function pagesBeyondAddressFamilySample(rankedPages: readonly GeneratorPage[]): GeneratorPage[] {
  const pagesByFamily = new Map<string, GeneratorPage[]>();
  const addToFamily = (family: string, page: GeneratorPage) =>
    pagesByFamily.set(family, [...(pagesByFamily.get(family) ?? []), page]);
  for (const page of rankedPages) {
    if (page.assessment?.scope !== 'narrow' || isDocumentationPage(page) || page.assessment.pageType === 'legal') continue;
    const { origin } = new URL(page.record.normalisedUrl);
    const segments = pagePathSegmentsOf(page.record.normalisedUrl);
    if (segments.length >= 2) addToFamily(JSON.stringify([origin, 'directory', segments.slice(0, -1)]), page);
    // The slash is a word, so `/a-b/c` and `/a/b-c` are of different templates.
    const pathWords = segments.flatMap((segment) => ['/', ...(segment.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]);
    for (const { template } of templatesOf(pathWords)) addToFamily(JSON.stringify([origin, 'template', template]), page);
  }
  const beyondSample = new Set<GeneratorPage>();
  for (const pages of pagesByFamily.values()) {
    if (pages.length < MINIMUM_PAGES_IN_TEMPLATE_FAMILY) continue;
    for (const page of pages.slice(TEMPLATE_FAMILY_PAGES_LISTED)) beyondSample.add(page);
  }
  return [...beyondSample];
}

function wordsOf(title: string): string[] {
  return title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function boilerplateWordsOf(titles: readonly string[][]): Set<string> {
  const titleCounts = new Map<string, number>();
  for (const words of titles) {
    for (const word of new Set(words)) titleCounts.set(word, (titleCounts.get(word) ?? 0) + 1);
  }
  const minimumTitles = Math.max(2, titles.length * SHARE_OF_TITLES_THAT_MAKES_A_WORD_BOILERPLATE);
  return new Set([...titleCounts].filter(([, count]) => count >= minimumTitles).map(([word]) => word));
}

/**
 * A title with each run of one to three words replaced in turn by a gap: the templates it
 * could have been made from. Only those that keep enough words to tell a template by.
 */
function templatesOf(words: readonly string[]): { template: string; variedWords: string }[] {
  const templates = new Map<string, string>();
  for (let length = 1; length <= MAXIMUM_WORDS_THAT_VARY; length += 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const kept = [...words.slice(0, start), ...words.slice(start + length)];
      if (kept.filter((word) => !STOP_WORDS.has(word)).length < MINIMUM_SHARED_WORDS) continue;
      const template = JSON.stringify([words.slice(0, start), words.slice(start + length)]);
      if (!templates.has(template)) templates.set(template, words.slice(start, start + length).join(' '));
    }
  }
  return [...templates].map(([template, variedWords]) => ({ template, variedWords }));
}
