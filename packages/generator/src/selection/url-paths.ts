import { pagePathOf } from '@llms-txt/contracts';

// Reading and comparing URLs and the text made from them. Pure string work.

/**
 * The URL's path segments, lowercased and decoded. On a site that routes on the URL
 * fragment the route counts as path: `/#/guide/setup` is `guide`, `setup`.
 */
export function pathSegmentsOf(url: string): string[] {
  return pagePathOf(new URL(url))
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    });
}

/** The path a page stands at: `/guide/index.html` is the page of `/guide`. */
export function pagePathSegmentsOf(url: string): string[] {
  const segments = pathSegmentsOf(url);
  return /^index(?:\.html?|\.md)?$/.test(segments.at(-1) ?? '') ? segments.slice(0, -1) : segments;
}

/** `success-stories` -> `Success Stories`. */
export function titleCaseOf(slug: string): string {
  return slug
    .replace(/[-_+\s]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** `/blog/page/2`, `?page=3`, `?p=4`: listing pages, not content. */
export function isPaginationUrl(url: string): boolean {
  const parsed = new URL(url);
  if (/\/page\/\d+\/?$/.test(parsed.pathname)) return true;
  return ['page', 'p', 'paged'].some((name) => /^\d+$/.test(parsed.searchParams.get(name) ?? ''));
}

/** Enough normalisation to match a declared canonical URL against a row's normalised URL. */
export function canonicalKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    const href = parsed.href;
    return parsed.pathname === '/' && parsed.search === '' ? href.replace(/\/$/, '') : href;
  } catch {
    return url;
  }
}

/**
 * Orders text with runs of digits compared as numbers, so `/posts/2` comes before
 * `/posts/10`. Locale-independent, so the output does not depend on the machine.
 */
export function compareText(a: string, b: string): number {
  const aParts = a.match(/\d+|\D+/g) ?? [];
  const bParts = b.match(/\d+|\D+/g) ?? [];
  for (let index = 0; index < Math.min(aParts.length, bParts.length); index += 1) {
    const aPart = aParts[index]!;
    const bPart = bParts[index]!;
    if (aPart === bPart) continue;
    const bothNumeric = /^\d/.test(aPart) && /^\d/.test(bPart);
    if (bothNumeric && aPart.length !== bPart.length) {
      const difference = Number(aPart) - Number(bPart);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    }
    return aPart < bPart ? -1 : 1;
  }
  return aParts.length - bParts.length || (a < b ? -1 : a > b ? 1 : 0);
}
