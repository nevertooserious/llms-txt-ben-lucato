import type { GeneratorPage } from '@llms-txt/contracts';
import type { EntryTextContext } from './entry-text-context';
import { normaliseForComparison, singleLine } from './text';

/** A description of fewer words that is not even a sentence is a label left in a template. */
const MINIMUM_FRAGMENT_DESCRIPTION_WORDS = 4;
/** A paragraph shorter than this is a caption or a byline. */
const MINIMUM_PARAGRAPH_LENGTH = 50;
/** A description taken from the content stops at the sentence that passes this length. */
const PREFERRED_PARAGRAPH_DESCRIPTION_LENGTH = 200;

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
