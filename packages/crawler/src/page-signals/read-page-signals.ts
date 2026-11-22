import { load } from 'cheerio/slim';
import { ROBOTS_USER_AGENT_TOKEN } from '../discovery/robots-rules';

// What the crawler reads from a page's HTML for itself: the links to follow, which of
// them are site navigation, and how much content the HTML holds. This is deliberately
// shallow. Content extraction is the extractor's job; the crawler only needs enough to
// discover URLs and to tell an empty JavaScript shell from a real page.

export interface PageSignals {
  /** Absolute URLs of every <a href>, resolved against <base href> and the page URL. */
  linkUrls: string[];
  /** The subset of `linkUrls` inside <nav>, <header> or role="navigation", with each link's text. */
  navigationLinks: NavigationLink[];
  /** Characters of visible text in <body>, whitespace collapsed. */
  visibleTextLength: number;
  /** An empty framework mount point or a "please enable JavaScript" notice. */
  hasJavaScriptShellMarker: boolean;
  /** The page has at least one executable <script>; without one, rendering adds nothing. */
  hasScripts: boolean;
  /**
   * Where `<meta http-equiv="refresh">` sends the reader at once (a delay of at most
   * MAXIMUM_REDIRECTING_REFRESH_SECONDS), absolute. Such a page is a redirect written in
   * HTML. Null when there is none.
   */
  metaRefreshUrl: string | null;
  /** A robots directive for this crawler forbids following the page's links. */
  isNofollow: boolean;
  /** A robots directive for this crawler asks that the page not be indexed or listed. */
  isNoindex: boolean;
}

export interface NavigationLink {
  url: string;
  /** The link's text, else its aria-label or title. Null when there is none short enough to be a name. */
  label: string | null;
}

/** A refresh after longer than this reloads or moves on from a page that is meant to be read. */
const MAXIMUM_REDIRECTING_REFRESH_SECONDS = 5;

/** Longer link text is a sentence or a teaser, not the name of a page. */
const MAXIMUM_NAVIGATION_LABEL_LENGTH = 40;

// Mount points the common frameworks render into.
const APP_ROOT_SELECTORS = ['#root', '#app', '#__next', '#__nuxt', '#svelte', '[data-reactroot]', 'app-root'];
// No type, a JavaScript MIME type, or a module. Not JSON-LD, templates or import maps.
const EXECUTABLE_SCRIPT_TYPE_PATTERN = /^\s*$|^\s*(module|(text|application)\/(x-)?(java|ecma)script)\s*$/i;
const ENABLE_JAVASCRIPT_PATTERN = /\b(enable|requires?|turn on)\b[^.]{0,40}\bjavascript\b/i;
// X-Robots-Tag directives that take a value after a colon, as a crawler's name does.
const VALUED_ROBOTS_DIRECTIVES = new Set(['unavailable_after', 'max-snippet', 'max-image-preview', 'max-video-preview']);

/**
 * `headers` are the response headers, lowercased, for X-Robots-Tag. Robots directives
 * come from it and from `<meta name="robots">` or `<meta name="LlmsTxtGenerator">`.
 */
export function readPageSignals(html: string, pageUrl: string, headers: Record<string, string> = {}): PageSignals {
  const $ = load(html);

  const baseHref = $('base[href]').first().attr('href');
  const baseUrl = (baseHref !== undefined && tryResolve(baseHref, pageUrl)) || pageUrl;

  const linkUrls: string[] = [];
  const navigationLinks: NavigationLink[] = [];
  $('a[href]').each((_index, element) => {
    const anchor = $(element);
    if (/\bnofollow\b/i.test(anchor.attr('rel') ?? '')) return;
    const resolved = tryResolve(anchor.attr('href') ?? '', baseUrl);
    if (resolved === null) return;
    linkUrls.push(resolved);
    if (anchor.closest('nav, header, [role="navigation"]').length > 0) {
      navigationLinks.push({ url: resolved, label: navigationLabelOf(anchor.text(), anchor.attr('aria-label'), anchor.attr('title')) });
    }
  });

  const noscriptText = $('noscript').text();
  const hasEmptyAppRoot = APP_ROOT_SELECTORS.some((selector) => {
    const root = $(selector).first();
    return root.length > 0 && root.text().trim() === '';
  });

  const body = $('body').clone();
  body.find('script, style, noscript, template, svg').remove();
  const visibleTextLength = body.text().replace(/\s+/g, ' ').trim().length;

  const hasScripts = $('script')
    .toArray()
    .some((script) => EXECUTABLE_SCRIPT_TYPE_PATTERN.test($(script).attr('type') ?? ''));

  const directives = new Set(readXRobotsTag(headers['x-robots-tag'] ?? ''));
  $('meta[name]').each((_index, element) => {
    const name = ($(element).attr('name') ?? '').trim().toLowerCase();
    if (name !== 'robots' && name !== ROBOTS_USER_AGENT_TOKEN.toLowerCase()) return;
    for (const directive of ($(element).attr('content') ?? '').split(',')) directives.add(directive.trim().toLowerCase());
  });

  return {
    linkUrls,
    navigationLinks,
    metaRefreshUrl: readMetaRefreshUrl($('meta[http-equiv]').toArray().map((element) => $(element).attr()), baseUrl),
    visibleTextLength,
    hasJavaScriptShellMarker: hasEmptyAppRoot || ENABLE_JAVASCRIPT_PATTERN.test(noscriptText),
    hasScripts,
    isNofollow: directives.has('nofollow') || directives.has('none'),
    isNoindex: directives.has('noindex') || directives.has('none'),
  };
}

/**
 * Each run of visible text in <body>, whitespace collapsed, in page order. Enough to
 * tell whether two renders of one document show the same page.
 */
export function readVisibleTextBlocks(html: string): string[] {
  const $ = load(html);
  $('script, style, noscript, template').remove();
  const blocks: string[] = [];
  $('body')
    .find('*')
    .addBack()
    .contents()
    .each((_index, node) => {
      if (node.type !== 'text') return;
      const text = node.data.replace(/\s+/g, ' ').trim();
      if (text !== '') blocks.push(text);
    });
  return blocks;
}

/** The target of the first `<meta http-equiv="refresh" content="0; url=/new">` that redirects. */
function readMetaRefreshUrl(metaAttributes: Array<Record<string, string> | undefined>, baseUrl: string): string | null {
  for (const attributes of metaAttributes) {
    if ((attributes?.['http-equiv'] ?? '').trim().toLowerCase() !== 'refresh') continue;
    const match = /^\s*(\d+(?:\.\d+)?)\s*[;,]\s*(?:url\s*=\s*)?["']?([^"']+?)["']?\s*$/i.exec(attributes?.content ?? '');
    if (match === null || Number(match[1]) > MAXIMUM_REDIRECTING_REFRESH_SECONDS) continue;
    const target = tryResolve(match[2]!, baseUrl);
    if (target !== null && /^https?:/.test(target)) return target;
  }
  return null;
}

function navigationLabelOf(...candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    const label = (candidate ?? '').replace(/\s+/g, ' ').trim();
    if (label !== '' && label.length <= MAXIMUM_NAVIGATION_LABEL_LENGTH) return label;
  }
  return null;
}

/**
 * Directives from an X-Robots-Tag value that apply to this crawler. A directive may be
 * scoped to one crawler (`googlebot: noindex`); the scope carries over to the
 * directives after it until another scope starts. Unscoped directives apply to all.
 */
export function readXRobotsTag(headerValue: string): string[] {
  const applicable: string[] = [];
  let scope: string | null = null;
  for (const rawPart of headerValue.split(',')) {
    let part = rawPart.trim().toLowerCase();
    const scoped = /^([a-z0-9_-]+)\s*:\s*(.*)$/.exec(part);
    // unavailable_after: <date> and max-snippet: -1 have a colon too, but are directives, not scopes.
    if (scoped !== null && !VALUED_ROBOTS_DIRECTIVES.has(scoped[1]!)) {
      scope = scoped[1]!;
      part = scoped[2]!.trim();
    }
    if (part === '') continue;
    if (scope === null || scope === ROBOTS_USER_AGENT_TOKEN.toLowerCase()) applicable.push(part);
  }
  return applicable;
}

function tryResolve(href: string, baseUrl: string): string | null {
  try {
    return new URL(href.trim(), baseUrl).href;
  } catch {
    return null;
  }
}
