// How a page title divides into the page's name and the site's (`Docs | Acme`).

/** What sites put between a page's name and the site's name in a title. */
export const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' · ', ' • ', ' » ', ' :: '];
/** One other page sharing part of a title could be chance; two look like a template. */
export const MINIMUM_PAGES_SHARING_SITE_NAME = 2;

/** A title with the site's names taken off its ends. */
export interface OwnTitle {
  title: string;
  /** The names taken off the end, outermost first, each with the separator before it. */
  removedEndings: readonly { separator: string; name: string }[];
}

/**
 * Takes the names a site's titles end with off the end of one (`Docs | Acme`), and the
 * site's own name off the start (`Acme | Docs`). A title that is only a name is kept.
 */
export function withoutSiteNames(fullTitle: string, endingNames: readonly string[], siteTitle: string): OwnTitle {
  let title = fullTitle;
  const removedEndings: { separator: string; name: string }[] = [];
  // Twice, for `Page | Area | Site`.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const separator of TITLE_SEPARATORS) {
      for (const name of endingNames) {
        const suffix = `${separator}${name}`;
        if (title.length > suffix.length && title.endsWith(suffix)) {
          title = title.slice(0, -suffix.length).trim();
          removedEndings.push({ separator, name });
        }
      }
      const prefix = `${siteTitle}${separator}`;
      if (siteTitle !== '' && title.length > prefix.length && title.startsWith(prefix)) {
        title = title.slice(prefix.length).trim();
      }
    }
  }
  return { title, removedEndings };
}

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

/** `Docs`, `Acme` and `A fast tool` in `Docs | Acme - A fast tool`. */
export function titlePartsOf(title: string): string[] {
  let parts = [title];
  for (const separator of TITLE_SEPARATORS) parts = parts.flatMap((part) => part.split(separator));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}
