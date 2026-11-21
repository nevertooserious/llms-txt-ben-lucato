// Text helpers the entry text and the renderer share.

/** Descriptions are cut to this length at a word boundary, so an entry stays one readable line. */
const MAXIMUM_DESCRIPTION_LENGTH = 300;

/** Collapses whitespace, newlines included, so text cannot break out of its line. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string): string {
  if (text.length <= MAXIMUM_DESCRIPTION_LENGTH) return text;
  const cut = text.slice(0, MAXIMUM_DESCRIPTION_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAXIMUM_DESCRIPTION_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Case, whitespace and closing punctuation do not make two texts different. */
export function normaliseForComparison(text: string): string {
  return singleLine(text).toLowerCase().replace(/[.!?…]+$/, '');
}
