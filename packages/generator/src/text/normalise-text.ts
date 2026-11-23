// Text helpers that naming, enrichment and the renderer share.

/** Descriptions are cut to this length at a word boundary, so an entry stays one readable line. */
const MAXIMUM_DESCRIPTION_LENGTH = 300;

/** Collapses whitespace, newlines included, so text cannot break out of its line. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, maximumLength = MAXIMUM_DESCRIPTION_LENGTH): string {
  if (text.length <= maximumLength) return text;
  // Not through the middle of a character: half of one is stored as a different character
  // than was rendered, and the file would then differ from its published version on every run.
  const cut = text.slice(0, maximumLength - 1).replace(/[\uD800-\uDBFF]$/, '');
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maximumLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Case, whitespace and closing punctuation do not make two texts different. */
export function normaliseForComparison(text: string): string {
  return singleLine(text).toLowerCase().replace(/[.!?…]+$/, '');
}
