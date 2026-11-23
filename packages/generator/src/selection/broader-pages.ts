import type { GeneratorPage } from '@llms-txt/contracts';
import { pagePathSegmentsOf } from './url-paths';

/**
 * Narrow pages with a broad page above them in the URL tree: a tutorial chapter under the
 * tutorial's index. The broad page stands for them. Judged here rather than by the model,
 * so a small site's only guide stays, and one page changing never reassesses its siblings.
 * Being in the navigation does not exempt a page: a homepage often links single chapters.
 */
export function pagesCoveredByBroaderPage(candidates: readonly GeneratorPage[]): GeneratorPage[] {
  const broadPaths = new Set(candidates.filter((page) => page.assessment?.scope === 'broad').map(pathKeyOf));
  return candidates.filter((page) => page.assessment?.scope === 'narrow' && hasPathAbove(page, broadPaths));
}

/** Whether one of the given page paths is strictly above this page, the site's root aside. */
function hasPathAbove(page: GeneratorPage, pathKeys: ReadonlySet<string>): boolean {
  const url = page.record.normalisedUrl;
  const segments = pagePathSegmentsOf(url);
  for (let length = segments.length - 1; length > 0; length -= 1) {
    if (pathKeys.has(JSON.stringify([new URL(url).origin, segments.slice(0, length)]))) return true;
  }
  return false;
}

/** A page's place in the URL tree. `/branches.html` stands at `/branches`, above `/branches/rome.html`. */
export function pathKeyOf(page: GeneratorPage): string {
  const url = page.record.normalisedUrl;
  const segments = pagePathSegmentsOf(url);
  const lastSegment = segments.at(-1);
  const path = lastSegment === undefined ? segments : [...segments.slice(0, -1), lastSegment.replace(/\.html?$/i, '')];
  return JSON.stringify([new URL(url).origin, path]);
}
