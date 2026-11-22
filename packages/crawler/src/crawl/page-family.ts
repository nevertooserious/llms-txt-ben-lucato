import { pagePathOf } from '@llms-txt/contracts';

/**
 * Directories that hold documentation. Its pages are what an llms.txt is for, and a site
 * lists them in the order they are to be read, so they are never held back. Only a
 * directory counts: `/tags/api` is a tag, not a page of an API's documentation.
 */
const DOCUMENTATION_SEGMENT =
  /^(?:docs?|documentation|manual|handbook|reference|references|apis?|api-reference|api-docs|guides?|tutorials?|learn|help|kb|knowledge-base|wiki)$/i;

/**
 * The family a page belongs to, going by its URL alone: the first path segment below the
 * site's root and how deep the page is, with a number read as any number. So the posts
 * of a blog are one family whatever their dates (`/2026/Mar/3/a-post` and
 * `/2025/Dec/31/another`), and so are its tags (`/tags/python`), while `/about` and
 * `/tags` are not of either. Deliberately coarse: it is used to sample a site, not to
 * describe it.
 *
 * Null for a page that is never held back behind other families: the root page, a page on
 * another host, and any page of documentation.
 */
export function pageFamilyKeyOf(pageUrl: string, rootUrl: string): string | null {
  const page = new URL(pageUrl);
  const root = new URL(rootUrl);
  if (page.host !== root.host) return null;
  if (DOCUMENTATION_SEGMENT.test(root.hostname.split('.')[0]!)) return null;

  const segments = segmentsOf(page);
  if (segments.slice(0, -1).some((segment) => DOCUMENTATION_SEGMENT.test(segment))) return null;
  const rootSegments = segmentsOf(root);
  const isUnderRoot = rootSegments.every((segment, index) => segments[index] === segment);
  const segmentsBelowRoot = isUnderRoot ? segments.slice(rootSegments.length) : segments;
  if (segmentsBelowRoot.length === 0) return null;
  const firstSegment = segmentsBelowRoot.length === 1 ? '' : segmentsBelowRoot[0]!;
  return `${/^\d+$/.test(firstSegment) ? '#' : firstSegment.toLowerCase()}/${segmentsBelowRoot.length}`;
}

function segmentsOf(url: URL): string[] {
  return pagePathOf(url).split('/').filter(Boolean);
}

/**
 * The area of a site's documentation a page is in: the documentation's own directory and
 * the first name below it, so `/docs/features/ssh` and `/docs/features` are both of
 * `docs/features`, and `/docs/install` is of `docs/install`. On a site that is all
 * documentation (a `docs.` host, or a root under `/docs`) it is the first name below the
 * root. A crawl takes pages from each area in turn (see `takeNextFromFrontier`).
 *
 * A page at the top of the documentation is an area of one page until its children are
 * found, so every area's first page comes before any area's second.
 *
 * Null for a page that is not documentation, and for the root page.
 */
export function documentationAreaKeyOf(pageUrl: string, rootUrl: string): string | null {
  const page = new URL(pageUrl);
  const root = new URL(rootUrl);
  if (page.host !== root.host) return null;

  const segments = segmentsOf(page).map((segment) => segment.toLowerCase());
  const documentationIndex = segments.slice(0, -1).findIndex((segment) => DOCUMENTATION_SEGMENT.test(segment));
  if (documentationIndex !== -1) return segments.slice(0, documentationIndex + 2).join('/');
  if (!DOCUMENTATION_SEGMENT.test(root.hostname.split('.')[0]!)) return null;

  const rootSegmentCount = segmentsOf(root).length;
  const isUnderRoot = segmentsOf(root).every((segment, index) => segments[index] === segment.toLowerCase());
  const areaLength = isUnderRoot ? rootSegmentCount + 1 : 1;
  return segments.length < areaLength ? null : segments.slice(0, areaLength).join('/');
}
