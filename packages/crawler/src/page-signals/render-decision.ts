import { fragmentRoutePathOf } from '@llms-txt/contracts';
import { isInScope, normaliseUrl } from '../discovery/normalise-url';
import type { PageSignals } from './read-page-signals';

// When to use the headless browser (docs/design/README.md, section 2, Fetching).
//
// Per site: on a first crawl the homepage is fetched both ways and compared. If the
// browser finds much more text, or many pages of the site that plain HTTP does not link,
// the whole site is rendered. Rendering costs seconds a page, so a site whose plain HTML
// already links its pages must not be rendered for the sake of a carousel of sponsors. The answer is stored in sites.requires_headless_rendering, so later checks
// skip the comparison until it is re-decided.
//
// Per page: on a site that does not need rendering, a page whose plain HTML looks like
// an empty JavaScript shell is rendered anyway. This catches a client-rendered section
// of an otherwise server-rendered site.

/** The rendered page must have at least this many more characters of text... */
const MIN_EXTRA_TEXT_CHARACTERS = 200;
/** ...and at least this multiple of the plain text, to count as gaining content. */
const MIN_TEXT_GROWTH_FACTOR = 1.5;
/**
 * Or this many pages of the site linked only after rendering, which catches menus and
 * link lists rendered by script...
 */
const MIN_EXTRA_LINKS = 5;
/** ...and at least this share of what the plain HTML links, as with the text. */
const MIN_EXTRA_LINKS_SHARE = 0.5;

/** Below both of these, a plain page is empty: not short, empty. */
const EMPTY_PAGE_MAX_TEXT_CHARACTERS = 50;
const EMPTY_PAGE_MAX_LINKS = 3;
/** An empty app mount point counts while the rest of the page holds less than this. */
const SHELL_MARKER_MAX_TEXT_CHARACTERS = 1000;

/**
 * Whether the rendered version of a page holds content the plain HTML lacks. Links are
 * counted as distinct pages of the site (`isOnSite`): the same link repeated in a
 * script-built menu, or links to other sites, give the crawl nothing new to fetch.
 */
export function renderingAddsContent(
  plain: PageSignals,
  rendered: PageSignals,
  isOnSite: (url: string) => boolean = () => true,
): boolean {
  const extraText = rendered.visibleTextLength - plain.visibleTextLength;
  const textGrew =
    extraText >= MIN_EXTRA_TEXT_CHARACTERS && rendered.visibleTextLength >= plain.visibleTextLength * MIN_TEXT_GROWTH_FACTOR;

  const plainPages = sitePagesLinkedBy(plain, isOnSite);
  const extraPages = [...sitePagesLinkedBy(rendered, isOnSite)].filter((url) => !plainPages.has(url)).length;
  const linksGrew = extraPages >= MIN_EXTRA_LINKS && extraPages >= plainPages.size * MIN_EXTRA_LINKS_SHARE;
  return textGrew || linksGrew;
}

/** A site routes on the URL fragment when its homepage links at least this many routes of itself... */
const MIN_FRAGMENT_ROUTES = 3;
/** ...and at least this many of them for each other page of the site it links. */
const FRAGMENT_ROUTES_PER_PATH_PAGE = 2;

/**
 * Whether the rendered homepage is a single page that shows a route named in the URL
 * fragment: most of what it links are routes of itself (`#/install`, `#!/guide`). Strict
 * on purpose. A site wrongly taken for one would have each such link crawled as a page;
 * one that is missed fails as it did before, with a message that says why.
 */
export function routesOnUrlFragment(renderedHomepage: PageSignals, rootUrl: string): boolean {
  const routes = new Set<string>();
  const otherPages = new Set<string>();
  for (const linkUrl of renderedHomepage.linkUrls) {
    const url = normaliseUrl(linkUrl);
    if (url === null || !isInScope(url, rootUrl)) continue;
    if (url !== rootUrl) otherPages.add(url);
    else if (fragmentRoutePathOf(new URL(linkUrl)) !== '') routes.add(fragmentRoutePathOf(new URL(linkUrl)));
  }
  return routes.size >= MIN_FRAGMENT_ROUTES && routes.size >= otherPages.size * FRAGMENT_ROUTES_PER_PATH_PAGE;
}

/** The distinct pages of the site a page links, by normalised URL. */
function sitePagesLinkedBy(signals: PageSignals, isOnSite: (url: string) => boolean): Set<string> {
  const pages = new Set<string>();
  for (const linkUrl of signals.linkUrls) {
    const url = normaliseUrl(linkUrl);
    if (url !== null && isOnSite(url)) pages.add(url);
  }
  return pages;
}

/**
 * The per-page safety net: plain HTML that needs JavaScript to show anything. Short
 * pages are common and fine, so this asks for an empty page or an empty app mount
 * point, not merely little text.
 */
export function looksLikeJavaScriptShell(plain: PageSignals): boolean {
  if (!plain.hasScripts) return false;
  const isEmpty = plain.visibleTextLength < EMPTY_PAGE_MAX_TEXT_CHARACTERS && plain.linkUrls.length < EMPTY_PAGE_MAX_LINKS;
  return isEmpty || (plain.hasJavaScriptShellMarker && plain.visibleTextLength < SHELL_MARKER_MAX_TEXT_CHARACTERS);
}

/** After a safety-net render: keep the rendered page only if it shows more text or more links. */
export function renderedPageIsBetter(plain: PageSignals, rendered: PageSignals): boolean {
  return rendered.visibleTextLength > plain.visibleTextLength || rendered.linkUrls.length > plain.linkUrls.length;
}
