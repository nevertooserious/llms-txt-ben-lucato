import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf } from '../selection';
import { normaliseForComparison, singleLine } from '../text/normalise-text';
import { lastTitlePartOf, MINIMUM_PAGES_SHARING_SITE_NAME, withoutSiteNames } from './title-parts';

/** One area's name on every title tells no page from another. */
const MINIMUM_AREAS_TO_NAME_THEM = 2;

/** What the pages of a site share, worked out once per render. */
export interface NamingContext {
  siteTitle: string;
  /** The homepage's own title, which some sites repeat as every page's og:title. */
  homepageTitle: string;
  /** Names that titles end with across the site (`| Acme`, `| Acme Foundation`), longest first. */
  titleSuffixes: readonly string[];
  /**
   * Names of the site's areas, where its titles end with one of several (`Svelte Docs`,
   * `SvelteKit Docs`). Empty on a site whose titles all end the same way.
   */
  areaNames: ReadonlySet<string>;
  /** Titles, as normaliseForComparison leaves them, that pages of different areas share (`FAQ`). */
  titlesSharedAcrossAreas: ReadonlySet<string>;
}

export function buildNamingContext(siteTitle: string, pages: readonly GeneratorPage[]): NamingContext {
  const homepage = homepageOf(pages);
  const suffixes = titleEndsOnSeveralPages(pages, new Set());
  // Again without those, for a title that ends with two names: `Page - Project - Publisher`.
  for (const suffix of titleEndsOnSeveralPages(pages, suffixes)) suffixes.add(suffix);
  if (siteTitle !== '') suffixes.add(siteTitle);

  const titleSuffixes = [...suffixes].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return {
    siteTitle,
    homepageTitle: singleLine(homepage?.record.title ?? ''),
    titleSuffixes,
    ...areasOf(pages, titleSuffixes, siteTitle),
  };
}

/** The name of the area a title ends with: the innermost name taken off it, unless that is the site's. */
export function areaNameOf(
  removedEndings: readonly { separator: string; name: string }[],
  areaNames: ReadonlySet<string>,
): { separator: string; name: string } | null {
  const innermost = removedEndings.at(-1);
  return innermost !== undefined && areaNames.has(innermost.name) ? innermost : null;
}

/**
 * A site with several sets of documentation ends each page's title with its set's name
 * (`Overview • Svelte Docs`, `Introduction • SvelteKit Docs`). Those names are taken off
 * like the site's own, but they are what tells one `FAQ` from another. A name that also
 * stands outside another on some title (`Page - Project - Publisher`) is the site's or
 * its publisher's, not an area's.
 */
function areasOf(
  pages: readonly GeneratorPage[],
  titleSuffixes: readonly string[],
  siteTitle: string,
): Pick<NamingContext, 'areaNames' | 'titlesSharedAcrossAreas'> {
  const ownTitles = pages.map((page) => withoutSiteNames(singleLine(page.record.title ?? ''), titleSuffixes, siteTitle));
  const outerNames = new Set(ownTitles.flatMap((own) => own.removedEndings.slice(0, -1).map((ending) => ending.name)));
  const areaNames = new Set(
    ownTitles
      .map((own) => own.removedEndings.at(-1)?.name)
      .filter((name): name is string => name !== undefined && name !== siteTitle && !outerNames.has(name)),
  );
  if (areaNames.size < MINIMUM_AREAS_TO_NAME_THEM) return { areaNames: new Set(), titlesSharedAcrossAreas: new Set() };

  const areasByTitle = new Map<string, Set<string>>();
  for (const own of ownTitles) {
    const key = normaliseForComparison(own.title);
    if (key === '') continue;
    let areas = areasByTitle.get(key);
    if (areas === undefined) areasByTitle.set(key, (areas = new Set()));
    areas.add(areaNameOf(own.removedEndings, areaNames)?.name ?? '');
  }
  return {
    areaNames,
    titlesSharedAcrossAreas: new Set([...areasByTitle].filter(([, areas]) => areas.size > 1).map(([title]) => title)),
  };
}

/**
 * Title endings that enough pages with different content carry, once the endings
 * already known are taken off. Counting distinct content keeps copies of one page (`/a`
 * and `/a?ref=x`) from making its title look like the site's name.
 */
function titleEndsOnSeveralPages(pages: readonly GeneratorPage[], knownEndings: ReadonlySet<string>): Set<string> {
  const contentDigestsByText = new Map<string, Set<string>>();
  for (const page of pages) {
    let title = singleLine(page.record.title ?? '');
    let text = lastTitlePartOf(title);
    if (knownEndings.size > 0) {
      // Only a title that ends with a known name can have a second one before it.
      if (text === null || !knownEndings.has(text)) continue;
      title = title.slice(0, title.lastIndexOf(text)).replace(/[\s|\-–—·•»:]+$/u, '');
      text = lastTitlePartOf(title);
    }
    if (!text) continue;
    let contentDigests = contentDigestsByText.get(text);
    if (contentDigests === undefined) contentDigestsByText.set(text, (contentDigests = new Set()));
    contentDigests.add(page.record.contentDigest);
  }
  return new Set(
    [...contentDigestsByText]
      .filter(([, contentDigests]) => contentDigests.size >= MINIMUM_PAGES_SHARING_SITE_NAME)
      .map(([text]) => text),
  );
}
