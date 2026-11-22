import { isUrlUnderPrefix } from '@llms-txt/contracts';
import type { PathTreeGroup, SitePageView } from '@/shared/site-pages';

/** What the user chose on the pages panel: pages and whole paths to leave out, and pages to list regardless. */
export interface PageChoices {
  excludedUrls: ReadonlySet<string>;
  /** Paths as URL prefixes. Every page at or under one is left out, including pages found later. */
  excludedUrlPrefixes: ReadonlySet<string>;
  /** Pages listed even though the generator would leave them out. An exclusion still wins. */
  keptUrls: ReadonlySet<string>;
}

/** The excluded path a URL is at or under, if any. */
export function excludedPathOver(url: string, choices: PageChoices): string | null {
  for (const urlPrefix of choices.excludedUrlPrefixes) {
    if (isUrlUnderPrefix(url, urlPrefix)) return urlPrefix;
  }
  return null;
}

/** The user left this page out, by itself or by a path over it. */
export function isExcludedByUser(page: SitePageView, choices: PageChoices): boolean {
  return !page.isHomepage && (choices.excludedUrls.has(page.normalisedUrl) || excludedPathOver(page.normalisedUrl, choices) !== null);
}

/** Ticking the page can list it: the generator lists it, or it can be kept. The homepage is the H1, never an entry. */
export function canBeIncluded(page: SitePageView): boolean {
  return !page.isHomepage && (page.isChosenByGenerator || page.canBeKept);
}

/** The page is an entry of the file rendered with these choices. */
export function isIncluded(page: SitePageView, choices: PageChoices): boolean {
  if (page.isHomepage || isExcludedByUser(page, choices)) return false;
  return page.isChosenByGenerator || (page.canBeKept && choices.keptUrls.has(page.normalisedUrl));
}

/**
 * The choices after ticking or unticking one page. Only what differs from the
 * generator's own decision is stored: a page it lists is unticked by excluding it, and
 * a page it leaves out is ticked by keeping it.
 */
export function withPageIncluded(choices: PageChoices, page: SitePageView, isToBeIncluded: boolean): PageChoices {
  const excludedUrls = new Set(choices.excludedUrls);
  const keptUrls = new Set(choices.keptUrls);
  if (isToBeIncluded) {
    excludedUrls.delete(page.normalisedUrl);
    if (!page.isChosenByGenerator && page.canBeKept) keptUrls.add(page.normalisedUrl);
  } else {
    keptUrls.delete(page.normalisedUrl);
    if (page.isChosenByGenerator) excludedUrls.add(page.normalisedUrl);
  }
  return { ...choices, excludedUrls, keptUrls };
}

/** The choices after excluding a path, or including it again. Kept pages under it stay kept for when it returns. */
export function withPathExcluded(choices: PageChoices, urlPrefix: string, isToBeExcluded: boolean): PageChoices {
  const excludedUrlPrefixes = new Set(choices.excludedUrlPrefixes);
  if (isToBeExcluded) excludedUrlPrefixes.add(urlPrefix);
  else excludedUrlPrefixes.delete(urlPrefix);
  return { ...choices, excludedUrlPrefixes };
}

export type PathGroupState =
  /** The path itself is excluded. */
  | 'path_excluded'
  /** A path above this one is excluded, which is where to change it. */
  | 'under_excluded_path'
  /** Every page under it that can be listed is. */
  | 'all_included'
  | 'some_included'
  | 'none_included';

export function pathGroupState(group: PathTreeGroup, choices: PageChoices): PathGroupState {
  if (choices.excludedUrlPrefixes.has(group.urlPrefix)) return 'path_excluded';
  if (excludedPathOver(group.urlPrefix, choices) !== null) return 'under_excluded_path';
  const includablePages = group.pages.filter(canBeIncluded);
  const includedCount = includablePages.filter((page) => isIncluded(page, choices)).length;
  if (includedCount === includablePages.length) return 'all_included';
  return includedCount > 0 ? 'some_included' : 'none_included';
}

/**
 * The choices after a click on a path's checkbox. A path with everything listed is
 * excluded, which also covers pages found under it later; an excluded path is included
 * again; and a path with pages left out has all of them listed.
 */
export function withPathToggled(choices: PageChoices, group: PathTreeGroup): PageChoices {
  switch (pathGroupState(group, choices)) {
    case 'under_excluded_path':
      return choices;
    case 'path_excluded':
      return withPathExcluded(choices, group.urlPrefix, false);
    case 'all_included':
      return withPathExcluded(choices, group.urlPrefix, true);
    case 'some_included':
    case 'none_included': {
      const excludedUrlPrefixes = new Set(
        [...choices.excludedUrlPrefixes].filter((urlPrefix) => !isUrlUnderPrefix(urlPrefix, group.urlPrefix)),
      );
      return group.pages.filter(canBeIncluded).reduce<PageChoices>((next, page) => withPageIncluded(next, page, true), {
        ...choices,
        excludedUrlPrefixes,
      });
    }
  }
}
