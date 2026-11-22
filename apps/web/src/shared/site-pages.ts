// The JSON of GET /api/sites/{publicSlug}/pages, and how the site screen groups
// those pages by URL path. Shared by the route handler and the browser.

import { fragmentRoutePathOf } from '@llms-txt/contracts';

export interface SitePageView {
  normalisedUrl: string;
  title: string | null;
  /** The crawl root: it is the file's H1, so it is never an entry and cannot be ignored. */
  isHomepage: boolean;
  /** The user ignores this page by itself. A page can also be ignored by a path: see excludedUrlPrefixes. */
  isExcluded: boolean;
  /** The user lists this page even if the generator would leave it out. */
  isKept: boolean;
  /** The generator assessed this page, so keeping it can list it. */
  canBeKept: boolean;
  /** The section the page is listed under with the saved choices, or null if it is not listed. */
  listedInSection: string | null;
}

export interface SitePagesView {
  pages: SitePageView[];
  /**
   * The paths the user ignores, as URL prefixes with no trailing slash
   * (`https://example.com/blog`). Every page at or under one is left out, including
   * pages found by later crawls.
   */
  excludedUrlPrefixes: string[];
}

/** The body of PUT /api/sites/{publicSlug}/pages: the whole of what the user ignores. */
export interface PageExclusions {
  /** Pages ignored one by one. */
  excludedUrls: string[];
  excludedUrlPrefixes: string[];
  /** Pages listed whatever the generator would decide. Left as they are when absent. */
  keptUrls?: string[];
}

/** What saving the ignored pages and paths did to the file. */
export type SaveExclusionsResult =
  /** The file changed and this version was recorded. `isLive` is false when another version is pinned. */
  | { kind: 'published'; versionNumber: number; isLive: boolean }
  /** The choices were saved and the file reads the same, e.g. the pages were not listed anyway. */
  | { kind: 'unchanged' }
  /** A run is active or nothing has been generated yet, so the next run applies the choices. */
  | { kind: 'applied_by_next_run' };

export type PathTreeItem = PathTreePage | PathTreeGroup;

export interface PathTreePage {
  kind: 'page';
  /** The path as shown: `/docs/setup`, or with the host for a page on another host of the site. */
  label: string;
  page: SitePageView;
}

export interface PathTreeGroup {
  kind: 'group';
  /** The path prefix its pages share: `/docs/`. */
  label: string;
  /** The same prefix as a URL with no trailing slash, which is how an ignored path is stored. */
  urlPrefix: string;
  items: PathTreeItem[];
  /** Every page under the group, at any depth. */
  pages: SitePageView[];
}

interface PathNode {
  label: string;
  urlPrefix: string;
  pages: SitePageView[];
  children: Map<string, PathNode>;
}

/**
 * Groups pages by the directories of their URL paths. A directory becomes a group when
 * two or more pages sit under it; a page alone under its directory stays a row of the
 * parent, and a directory that holds nothing but one other group is skipped, so
 * `/docs/v2/a` and `/docs/v2/b` make one group `/docs/v2/`. A directory's own page
 * (`/docs`) is the first row of its group. Pages on another host of the site go under
 * that host's name. Sorted by path.
 */
export function groupPagesByPath(pages: readonly SitePageView[], rootUrl: string): PathTreeItem[] {
  const rootHost = parseUrl(rootUrl)?.host ?? null;
  const root: PathNode = { label: '', urlPrefix: '', pages: [], children: new Map() };
  for (const page of pages) {
    let node = root;
    for (const step of stepsTo(page.normalisedUrl, rootHost)) {
      let child = node.children.get(step.key);
      if (child === undefined) {
        child = { label: step.label, urlPrefix: step.urlPrefix, pages: [], children: new Map() };
        node.children.set(step.key, child);
      }
      node = child;
    }
    node.pages.push(page);
  }
  return itemsOf(root);
}

function itemsOf(node: PathNode): PathTreeItem[] {
  const ownPages = node.pages.map((page): PathTreePage => ({ kind: 'page', label: labelOf(page, node), page }));
  const children = [...node.children.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return [
    ...ownPages,
    ...children.map((child): PathTreeItem => {
      const items = itemsOf(child);
      if (items.length === 1) return items[0]!;
      return { kind: 'group', label: `${child.label}/`, urlPrefix: child.urlPrefix, items, pages: items.flatMap(pagesOf) };
    }),
  ];
}

function pagesOf(item: PathTreeItem): SitePageView[] {
  return item.kind === 'page' ? [item.page] : item.pages;
}

/** Pages that differ only in their query string share a node, so the label carries it. */
function labelOf(page: SitePageView, node: PathNode): string {
  return `${node.label || '/'}${parseUrl(page.normalisedUrl)?.search ?? ''}`;
}

/** The nodes from the root down to a URL's own: its host if that is not the site's, then each path segment. */
function stepsTo(url: string, rootHost: string | null): Array<{ key: string; label: string; urlPrefix: string }> {
  const parsed = parseUrl(url);
  if (parsed === null) return [{ key: url, label: url, urlPrefix: url }];
  const steps: Array<{ key: string; label: string; urlPrefix: string }> = [];
  let label = '';
  let urlPrefix = parsed.origin;
  if (parsed.host !== rootHost) {
    label = parsed.host;
    steps.push({ key: parsed.host, label, urlPrefix });
  }
  for (const segment of parsed.pathname.split('/').filter((part) => part !== '')) {
    label = `${label}/${segment}`;
    urlPrefix = `${urlPrefix}/${segment}`;
    steps.push({ key: segment, label, urlPrefix });
  }
  // On a site that routes on the URL fragment, the route's segments follow the path's.
  const routeSegments = fragmentRoutePathOf(parsed).split('/').filter((part) => part !== '');
  for (const [index, segment] of routeSegments.entries()) {
    const separator = index === 0 ? '/#/' : '/';
    label = `${label}${separator}${segment}`;
    urlPrefix = `${urlPrefix}${separator}${segment}`;
    steps.push({ key: `${separator}${segment}`, label, urlPrefix });
  }
  return steps;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
