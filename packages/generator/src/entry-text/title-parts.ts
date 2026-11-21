// How a page title divides into the page's name and the site's (`Docs | Acme`).

/** What sites put between a page's name and the site's name in a title. */
export const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' · ', ' :: '];
/** One other page sharing part of a title could be chance; two look like a template. */
export const MINIMUM_PAGES_SHARING_SITE_NAME = 2;

/** `Acme` in `Docs | Acme`; null for a title with no separator. */
export function lastTitlePartOf(title: string): string | null {
  const partStart = Math.max(
    ...TITLE_SEPARATORS.map((separator) => {
      const index = title.lastIndexOf(separator);
      return index === -1 ? -1 : index + separator.length;
    }),
  );
  const part = partStart === -1 ? '' : title.slice(partStart).trim();
  return part === '' ? null : part;
}

export function firstTitlePartOf(title: string): string | null {
  const partEnds = TITLE_SEPARATORS.map((separator) => title.indexOf(separator)).filter((index) => index !== -1);
  const part = partEnds.length === 0 ? '' : title.slice(0, Math.min(...partEnds)).trim();
  return part === '' ? null : part;
}
