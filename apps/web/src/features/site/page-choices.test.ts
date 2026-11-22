import { describe, expect, it } from 'vitest';
import type { PathTreeGroup, SitePageView } from '@/shared/site-pages';
import { isIncluded, pathGroupState, withPageIncluded, withPathToggled, type PageChoices } from './page-choices';

const page = (path: string, fields: Partial<SitePageView> = {}): SitePageView => ({
  normalisedUrl: `https://example.com${path}`,
  title: null,
  isHomepage: false,
  isExcluded: false,
  isKept: false,
  canBeKept: true,
  isChosenByGenerator: true,
  listedInSection: 'Docs',
  ...fields,
});
const leftOut = (path: string, fields: Partial<SitePageView> = {}) =>
  page(path, { isChosenByGenerator: false, listedInSection: null, ...fields });

const NO_CHOICES: PageChoices = { excludedUrls: new Set(), excludedUrlPrefixes: new Set(), keptUrls: new Set() };
const groupOf = (pages: SitePageView[]): PathTreeGroup => ({
  kind: 'group',
  label: '/about/',
  urlPrefix: 'https://example.com/about',
  items: [],
  pages,
});
const asLists = (choices: PageChoices) => ({
  excludedUrls: [...choices.excludedUrls],
  excludedUrlPrefixes: [...choices.excludedUrlPrefixes],
  keptUrls: [...choices.keptUrls],
});

describe('isIncluded', () => {
  it('is the generator’s decision until the user changes it', () => {
    expect(isIncluded(page('/about'), NO_CHOICES)).toBe(true);
    expect(isIncluded(leftOut('/about/legal'), NO_CHOICES)).toBe(false);
  });

  it('lets an excluded path win over a kept page', () => {
    const choices = { ...NO_CHOICES, keptUrls: new Set(['https://example.com/about/legal']), excludedUrlPrefixes: new Set(['https://example.com/about']) };
    expect(isIncluded(leftOut('/about/legal'), choices)).toBe(false);
  });
});

describe('withPageIncluded', () => {
  it('keeps a page the generator left out when it is ticked, and forgets that when it is unticked', () => {
    const legal = leftOut('/about/legal');
    const ticked = withPageIncluded(NO_CHOICES, legal, true);
    expect(asLists(ticked)).toEqual({ excludedUrls: [], excludedUrlPrefixes: [], keptUrls: [legal.normalisedUrl] });
    expect(isIncluded(legal, ticked)).toBe(true);
    expect(asLists(withPageIncluded(ticked, legal, false))).toEqual(asLists(NO_CHOICES));
  });

  it('excludes a page the generator lists when it is unticked, and forgets that when it is ticked', () => {
    const about = page('/about');
    const unticked = withPageIncluded(NO_CHOICES, about, false);
    expect(asLists(unticked)).toEqual({ excludedUrls: [about.normalisedUrl], excludedUrlPrefixes: [], keptUrls: [] });
    expect(asLists(withPageIncluded(unticked, about, true))).toEqual(asLists(NO_CHOICES));
  });
});

describe('a path’s checkbox', () => {
  const about = page('/about');
  const legal = leftOut('/about/legal');
  const unlistable = leftOut('/about/print', { canBeKept: false });

  it('ignores pages that cannot be listed when saying whether everything is', () => {
    expect(pathGroupState(groupOf([about, unlistable]), NO_CHOICES)).toBe('all_included');
    expect(pathGroupState(groupOf([about, legal]), NO_CHOICES)).toBe('some_included');
    expect(pathGroupState(groupOf([legal]), NO_CHOICES)).toBe('none_included');
  });

  it('lists every page under a path that has pages left out', () => {
    const group = groupOf([about, legal, unlistable]);
    const choices = { ...NO_CHOICES, excludedUrls: new Set([about.normalisedUrl]), excludedUrlPrefixes: new Set(['https://example.com/about/team']) };
    const toggled = withPathToggled(choices, group);
    expect(asLists(toggled)).toEqual({ excludedUrls: [], excludedUrlPrefixes: [], keptUrls: [legal.normalisedUrl] });
    expect(pathGroupState(group, toggled)).toBe('all_included');
  });

  it('excludes a path with everything listed, and includes it again as it was', () => {
    const group = groupOf([about, legal]);
    const allListed = withPathToggled(NO_CHOICES, group);
    const excluded = withPathToggled(allListed, group);
    expect(asLists(excluded).excludedUrlPrefixes).toEqual(['https://example.com/about']);
    expect(pathGroupState(group, excluded)).toBe('path_excluded');
    expect(asLists(withPathToggled(excluded, group))).toEqual(asLists(allListed));
  });
});
