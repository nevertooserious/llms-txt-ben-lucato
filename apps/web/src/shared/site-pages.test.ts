import { describe, expect, it } from 'vitest';
import { groupPagesByPath, type PathTreeGroup, type PathTreeItem, type SitePageView } from './site-pages';

const ROOT_URL = 'https://example.com';

const page = (path: string): SitePageView => ({
  normalisedUrl: path.startsWith('http') ? path : `${ROOT_URL}${path}`,
  title: null,
  isHomepage: path === '/',
  isExcluded: false,
  isKept: false,
  canBeKept: false,
  listedInSection: null,
});

/** The tree as indented labels, one per line. */
const outline = (items: PathTreeItem[], indent = ''): string[] =>
  items.flatMap((item) =>
    item.kind === 'page' ? [`${indent}${item.label}`] : [`${indent}${item.label} (${item.pages.length})`, ...outline(item.items, `${indent}  `)],
  );

describe('groupPagesByPath', () => {
  it('groups pages under the directories they share', () => {
    const pages = ['/', '/pricing', '/docs', '/docs/setup', '/docs/api/auth', '/docs/api/users', '/blog/one'].map(page);
    expect(outline(groupPagesByPath(pages, ROOT_URL))).toEqual([
      '/',
      '/blog/one',
      '/docs/ (4)',
      '  /docs',
      '  /docs/api/ (2)',
      '    /docs/api/auth',
      '    /docs/api/users',
      '  /docs/setup',
      '/pricing',
    ]);
  });

  it('skips a directory that holds only one other group', () => {
    const pages = ['/docs/v2/a', '/docs/v2/b'].map(page);
    expect(outline(groupPagesByPath(pages, ROOT_URL))).toEqual(['/docs/v2/ (2)', '  /docs/v2/a', '  /docs/v2/b']);
  });

  it('keeps query strings apart and puts another host under its own name', () => {
    const pages = ['/search?q=a', '/search?q=b', 'https://docs.example.com/start', 'https://docs.example.com/api'].map(page);
    expect(outline(groupPagesByPath(pages, ROOT_URL))).toEqual([
      '/search/ (2)',
      '  /search?q=a',
      '  /search?q=b',
      'docs.example.com/ (2)',
      '  docs.example.com/api',
      '  docs.example.com/start',
    ]);
  });

  it('gives each group the URL prefix an ignored path is stored as', () => {
    const pages = ['/docs/v2/a', '/docs/v2/b', 'https://docs.example.com/start', 'https://docs.example.com/api'].map(page);
    const groups = groupPagesByPath(pages, ROOT_URL).filter((item): item is PathTreeGroup => item.kind === 'group');
    expect(groups.map((group) => group.urlPrefix)).toEqual(['https://example.com/docs/v2', 'https://docs.example.com']);
  });
});

describe('groupPagesByPath, on a site that routes on the URL fragment', () => {
  it('groups routes as it groups paths, and gives a group the prefix that covers its routes', () => {
    const pages = ['/', '/#/install', '/#/guide', '/#/guide/setup', '/#/guide/plugins'].map(page);
    const tree = groupPagesByPath(pages, ROOT_URL);
    expect(outline(tree)).toEqual(['/', '/#/guide/ (3)', '  /#/guide', '  /#/guide/plugins', '  /#/guide/setup', '/#/install']);
    const guide = tree.find((item): item is PathTreeGroup => item.kind === 'group')!;
    expect(guide.urlPrefix).toBe('https://example.com/#/guide');
  });
});
