import { fragmentRoutePathOf } from '@llms-txt/contracts';
import { isInScope } from '../discovery/normalise-url';
import { TEXT_TYPES } from './media-types';
import type { PoliteFetcher } from './polite-fetcher';
import type { RobotsGate } from './robots-gate';

/** .md probes that may miss before the site is assumed to have none. */
const MARKDOWN_PROBES_BEFORE_GIVING_UP = 3;

/**
 * The llms.txt proposal says a site can serve a markdown file beside each HTML page.
 * Where one is present, the entry links it instead.
 */
export class MarkdownVariantProber {
  private misses = 0;
  private wasFound = false;

  constructor(
    private readonly rootUrl: string,
    private readonly politeFetcher: PoliteFetcher,
    private readonly robots: RobotsGate,
  ) {}

  async probe(pageUrl: string, { isHomepage = false, routesOnUrlFragment = false } = {}): Promise<string | null> {
    if (!this.wasFound && this.misses >= MARKDOWN_PROBES_BEFORE_GIVING_UP) return null;
    // The homepage's file goes by more names than any other page's, and the homepage is
    // listed only when it has one, so each name is tried. Together they count as one miss.
    const markdownUrls = isHomepage
      ? homepageMarkdownVariantUrlsFor(pageUrl, { routesOnUrlFragment })
      : [markdownVariantUrlFor(pageUrl)];
    let wasProbed = false;
    for (const markdownUrl of markdownUrls) {
      if (markdownUrl === null || !this.robots.isAllowed(markdownUrl)) continue;
      wasProbed = true;
      const outcome = await this.politeFetcher.fetch({
        url: markdownUrl,
        acceptedContentTypes: TEXT_TYPES,
        isRedirectAllowed: this.robots.isRedirectAllowed,
      });
      const found =
        outcome.kind === 'response' &&
        outcome.httpStatusCode === 200 &&
        outcome.contentType !== null &&
        isInScope(outcome.finalUrl, this.rootUrl);
      if (!found) continue;
      this.wasFound = true;
      return outcome.finalUrl;
    }
    if (wasProbed) this.misses += 1;
    return null;
  }
}

export function markdownVariantUrlFor(pageUrl: string): string | null {
  const url = new URL(pageUrl);
  if (url.search !== '' || url.pathname.endsWith('.md')) return null;
  // A route in the fragment is served from a file of that name beside the page, where
  // the site is written in markdown (Docsify): `/#/install` from `/install.md`.
  const routePath = fragmentRoutePathOf(url);
  if (routePath !== '') {
    url.hash = '';
    // The page is a directory (`/docs/`) or a file in one (`/docs/index.html`).
    const directory = url.pathname.replace(/\/[^/]*\.[^/]*$/, '').replace(/\/+$/, '');
    url.pathname = `${directory}${routePath}.md`;
    return url.href;
  }
  const lastSegment = url.pathname.split('/').pop() ?? '';
  url.pathname = lastSegment === '' ? `${url.pathname.replace(/\/$/, '')}/index.html.md` : `${url.pathname}.md`;
  return url.href;
}

/**
 * The names a homepage's markdown goes by, likeliest first: `index.html.md` as the
 * llms.txt proposal has it, `index.md` as sites built from markdown serve it, and on a
 * site that routes on the URL fragment `README.md`, the file its root route shows (Docsify).
 */
export function homepageMarkdownVariantUrlsFor(
  homepageUrl: string,
  { routesOnUrlFragment = false } = {},
): string[] {
  const url = new URL(homepageUrl);
  if (url.search !== '' || url.pathname.endsWith('.md')) return [];
  url.hash = '';
  // The homepage is a directory (`/docs/`, `/docs`) or a file in one (`/docs/index.html`).
  const directory = url.pathname.replace(/\/[^/]*\.[^/]*$/, '').replace(/\/+$/, '');
  const fileNames = [...(routesOnUrlFragment ? ['README.md'] : []), 'index.html.md', 'index.md'];
  return fileNames.map((fileName) => {
    url.pathname = `${directory}/${fileName}`;
    return url.href;
  });
}

/** An llms.txt usually links .md variants; the page to crawl is the HTML they come from. */
export function htmlUrlForMarkdownLink(href: string, llmsTxtUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(href, llmsTxtUrl);
  } catch {
    return null;
  }
  if (url.pathname.endsWith('/index.html.md')) url.pathname = url.pathname.slice(0, -'index.html.md'.length);
  else if (url.pathname.endsWith('/index.md')) url.pathname = url.pathname.slice(0, -'index.md'.length);
  else if (url.pathname.endsWith('.md')) url.pathname = url.pathname.slice(0, -'.md'.length);
  return url.href;
}
