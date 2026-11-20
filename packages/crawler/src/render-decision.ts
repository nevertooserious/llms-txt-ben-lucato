import type { PageSignals } from './read-page-signals';

// When to use the headless browser (docs/design/README.md, section 2, Fetching).
//
// Per site: on a first crawl the homepage is fetched both ways and compared. If the
// browser finds much more text or many more links than plain HTTP, the whole site is
// rendered. The answer is stored in sites.requires_headless_rendering, so later checks
// skip the comparison until it is re-decided.
//
// Per page: on a site that does not need rendering, a page whose plain HTML looks like
// an empty JavaScript shell is rendered anyway. This catches a client-rendered section
// of an otherwise server-rendered site.

/** The rendered page must have at least this many more characters of text... */
const MIN_EXTRA_TEXT_CHARACTERS = 200;
/** ...and at least this multiple of the plain text, to count as gaining content. */
const MIN_TEXT_GROWTH_FACTOR = 1.5;
/** Or this many more links, which catches menus and link lists rendered by script. */
const MIN_EXTRA_LINKS = 5;

/** Below both of these, a plain page is empty: not short, empty. */
const EMPTY_PAGE_MAX_TEXT_CHARACTERS = 50;
const EMPTY_PAGE_MAX_LINKS = 3;
/** An empty app mount point counts while the rest of the page holds less than this. */
const SHELL_MARKER_MAX_TEXT_CHARACTERS = 1000;

/** Whether the rendered version of a page holds content the plain HTML lacks. */
export function renderingAddsContent(plain: PageSignals, rendered: PageSignals): boolean {
  const extraText = rendered.visibleTextLength - plain.visibleTextLength;
  const textGrew =
    extraText >= MIN_EXTRA_TEXT_CHARACTERS && rendered.visibleTextLength >= plain.visibleTextLength * MIN_TEXT_GROWTH_FACTOR;
  const linksGrew = rendered.linkUrls.length - plain.linkUrls.length >= MIN_EXTRA_LINKS;
  return textGrew || linksGrew;
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

/** After a safety-net render: keep the rendered page only if it shows more text. */
export function renderedPageIsBetter(plain: PageSignals, rendered: PageSignals): boolean {
  return rendered.visibleTextLength > plain.visibleTextLength || rendered.linkUrls.length > plain.linkUrls.length;
}
