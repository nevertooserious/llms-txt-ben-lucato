import {
  ASSESSED_PAGE_TYPES,
  PAGE_EXCLUSION_REASONS,
  PAGE_LISTING_VALUES,
  type AssessedPageType,
  type PageAssessment,
  type PageExclusionReason,
  type PageListingValue,
} from '@llms-txt/contracts';
import { normaliseForComparison } from '../text/normalise-text';
import { LlmOutputRejectedError, MAXIMUM_SITE_NOTES, type GeneratedSiteSummary } from './llm-client';

// What the generator accepts back from the LLM: every answer is checked against the
// contract and forced to plain single lines before anything is stored or rendered.

export function parsePageAssessment(responseText: string): PageAssessment {
  const parsed = parseJsonObject(responseText);
  const listingValue = parsed.listing_value as PageListingValue;
  const pageType = parsed.page_type as AssessedPageType;
  const exclusionReason = (parsed.exclusion_reason ?? null) as PageExclusionReason | null;
  if (!PAGE_LISTING_VALUES.includes(listingValue)) throw new LlmOutputRejectedError('unknown listing_value');
  if (!ASSESSED_PAGE_TYPES.includes(pageType)) throw new LlmOutputRejectedError('unknown page_type');
  if (exclusionReason !== null && !PAGE_EXCLUSION_REASONS.includes(exclusionReason)) {
    throw new LlmOutputRejectedError('unknown exclusion_reason');
  }
  if ((listingValue === 'exclude') !== (exclusionReason !== null)) {
    throw new LlmOutputRejectedError('exclusion_reason does not match listing_value');
  }
  const description = cleanGeneratedLine(parsed.description);
  if (description === '' && listingValue !== 'exclude') throw new LlmOutputRejectedError('empty description');
  return { description, listingValue, exclusionReason, pageType };
}

export function parseSiteSummary(responseText: string): GeneratedSiteSummary {
  const parsed = parseJsonObject(responseText);
  const summary = cleanGeneratedLine(parsed.summary);
  if (summary === '') throw new LlmOutputRejectedError('empty summary');
  if (!Array.isArray(parsed.notes)) throw new LlmOutputRejectedError('notes is not a list');
  // A note that says what the summary says, or what another note says, adds nothing.
  const seen = new Set([normaliseForComparison(summary)]);
  const notes: string[] = [];
  for (const note of parsed.notes.map(cleanGeneratedLine)) {
    const comparable = normaliseForComparison(note);
    if (note === '' || seen.has(comparable)) continue;
    seen.add(comparable);
    notes.push(note);
  }
  return { summary, notes: notes.slice(0, MAXIMUM_SITE_NOTES) };
}

function parseJsonObject(responseText: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new LlmOutputRejectedError('response is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new LlmOutputRejectedError('response is not an object');
  return parsed as Record<string, unknown>;
}

/**
 * Forces LLM output to one line of plain text, so that page text which steered the model
 * still cannot add headings, links or entries to the file.
 */
export function cleanGeneratedLine(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[#>\-\s]+/, '');
}
