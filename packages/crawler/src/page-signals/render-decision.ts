import { fragmentRoutePathOf } from '@llms-txt/contracts';
import { isInScope, normaliseUrl } from '../discovery/normalise-url';
import type { PageSignals } from './read-page-signals';

// When to use the headless browser (docs/design/README.md, "Crawler").
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

/** A site may route on the URL fragment when its homepage links at least this many routes of itself... */
const MIN_FRAGMENT_ROUTES = 3;
/** ...and at least this many of them for each other page of the site it links. */
const FRAGMENT_ROUTES_PER_PATH_PAGE = 2;
/** Two renders that share this much of their text, by length, show the same page. */
const SAME_PAGE_SHARED_TEXT_SHARE = 0.9;

/**
 * The routes of itself that a rendered homepage links (`#/install`, `#!/guide`), one URL
 * for each, when they are most of what it links: the sign of a single page that shows a
 * route named in the URL fragment. Empty otherwise.
 *
 * Only a sign. An API reference built with Swagger UI links `#/Pets/addPet` to open a
 * section of the one page, so the crawl also opens a route or two and asks
 * `showsAnotherPage`. Strict on purpose: a site wrongly taken for hash-routed would have
 * each such link crawled as a page, while one that is missed fails as it did before, with
 * a message that says why.
 */
export function fragmentRouteLinksOf(renderedHomepage: PageSignals, rootUrl: string): string[] {
  const routeLinks = new Map<string, string>();
  const otherPages = new Set<string>();
  for (const linkUrl of renderedHomepage.linkUrls) {
    const url = normaliseUrl(linkUrl);
    if (url === null || !isInScope(url, rootUrl)) continue;
    if (url !== rootUrl) {
      otherPages.add(url);
      continue;
    }
    const routePath = fragmentRoutePathOf(new URL(linkUrl));
    if (routePath !== '' && !routeLinks.has(routePath)) routeLinks.set(routePath, linkUrl);
  }
  const isMostlyRoutes =
    routeLinks.size >= MIN_FRAGMENT_ROUTES && routeLinks.size >= otherPages.size * FRAGMENT_ROUTES_PER_PATH_PAGE;
  return isMostlyRoutes ? [...routeLinks.values()] : [];
}

/**
 * Whether the same document, opened at a route, shows another page than its homepage:
 * each holds text the other lacks. Opening a section of one long page (Swagger UI) adds
 * a little to text that is otherwise all still there.
 */
export function showsAnotherPage(homepageTextBlocks: readonly string[], routeTextBlocks: readonly string[]): boolean {
  return (
    sharedTextShare(homepageTextBlocks, routeTextBlocks) < SAME_PAGE_SHARED_TEXT_SHARE &&
    sharedTextShare(routeTextBlocks, homepageTextBlocks) < SAME_PAGE_SHARED_TEXT_SHARE
  );
}

/** How much of `blocks`, by length, is also in `otherBlocks`. 1 for no text at all. */
function sharedTextShare(blocks: readonly string[], otherBlocks: readonly string[]): number {
  const others = new Set(otherBlocks);
  let totalLength = 0;
  let sharedLength = 0;
  for (const block of blocks) {
    totalLength += block.length;
    if (others.has(block)) sharedLength += block.length;
  }
  return totalLength === 0 ? 1 : sharedLength / totalLength;
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
