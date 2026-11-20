import { createHash } from 'node:crypto';

const MONTH_NAMES =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const WEEKDAY_NAMES = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';

/** Removed in order, so a phrase goes before the words and digits inside it. */
const VOLATILE_PATTERNS: RegExp[] = [
  /\b(?:a|an|one|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/g,
  /\b(?:just now|today|yesterday|tomorrow|last (?:week|month|year))\b/g,
  /\d+(?:st|nd|rd|th)\b/g,
  new RegExp(`\\b(?:${MONTH_NAMES}|${WEEKDAY_NAMES})\\b\\.?`, 'g'),
  /\b(?:am|pm)\b/g,
  /\d+/g,
  /\s+/g,
];

/**
 * The coarse view of a page's content that content_digest hashes: its text with
 * dates, relative times, numbers and whitespace removed, so "updated 3 days ago" or
 * a view counter ticking over is not a change.
 */
export function normaliseTextForDigest(text: string): string {
  return VOLATILE_PATTERNS.reduce((normalised, pattern) => normalised.replace(pattern, ''), text.toLowerCase());
}

export function computeContentDigest(contentText: string): string {
  return sha256(normaliseTextForDigest(contentText));
}

/**
 * The monitor's change signal: what feeds the page's llms.txt entry. content_digest
 * counts only when there is no description, because then the entry's description is
 * generated from the content.
 */
export function computeListingFieldsHash(fields: {
  title: string | null;
  description: string | null;
  contentDigest: string;
}): string {
  return sha256(
    JSON.stringify([fields.title, fields.description, fields.description === null ? fields.contentDigest : null]),
  );
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
