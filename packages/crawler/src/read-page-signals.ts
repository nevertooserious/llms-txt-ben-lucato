import { load } from 'cheerio/slim';
import { ROBOTS_USER_AGENT_TOKEN } from './robots-rules';

// What the crawler reads from a page's HTML for itself: the links to follow, which of
// them are site navigation, and how much content the HTML holds. This is deliberately
// shallow. Content extraction is the extractor's job; the crawler only needs enough to
// discover URLs and to tell an empty JavaScript shell from a real page.

export interface PageSignals {
  /** Absolute URLs of every <a href>, resolved against <base href> and the page URL. */
  linkUrls: string[];
  /** The subset of `linkUrls` inside <nav> or <header>. */
  navigationLinkUrls: string[];
  /** Characters of visible text in <body>, whitespace collapsed. */
  visibleTextLength: number;
  /** An empty framework mount point or a "please enable JavaScript" notice. */
  hasJavaScriptShellMarker: boolean;
  /** The page has at least one executable <script>; without one, rendering adds nothing. */
  hasScripts: boolean;
  /** A robots directive for this crawler forbids following the page's links. */
  isNofollow: boolean;
  /** A robots directive for this crawler asks that the page not be indexed or listed. */
  isNoindex: boolean;
}

// Mount points the common frameworks render into.
const APP_ROOT_SELECTORS = ['#root', '#app', '#__next', '#__nuxt', '#svelte', '[data-reactroot]', 'app-root'];
// No type, a JavaScript MIME type, or a module. Not JSON-LD, templates or import maps.
const EXECUTABLE_SCRIPT_TYPE_PATTERN = /^\s*$|^\s*(module|(text|application)\/(x-)?(java|ecma)script)\s*$/i;
const ENABLE_JAVASCRIPT_PATTERN = /\b(enable|requires?|turn on)\b[^.]{0,40}\bjavascript\b/i;

/**
 * `headers` are the response headers, lowercased, for X-Robots-Tag. Robots directives
 * come from it and from `<meta name="robots">` or `<meta name="LlmsTxtGenerator">`.
 */
export function readPageSignals(html: string, pageUrl: string, headers: Record<string, string> = {}): PageSignals {
  const $ = load(html);

  const baseHref = $('base[href]').first().attr('href');
  const baseUrl = (baseHref !== undefined && tryResolve(baseHref, pageUrl)) || pageUrl;

  const linkUrls: string[] = [];
  const navigationLinkUrls: string[] = [];
  $('a[href]').each((_index, element) => {
    const anchor = $(element);
    if (/\bnofollow\b/i.test(anchor.attr('rel') ?? '')) return;
    const resolved = tryResolve(anchor.attr('href') ?? '', baseUrl);
    if (resolved === null) return;
    linkUrls.push(resolved);
    if (anchor.closest('nav, header, [role="navigation"]').length > 0) navigationLinkUrls.push(resolved);
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
    navigationLinkUrls,
    visibleTextLength,
    hasJavaScriptShellMarker: hasEmptyAppRoot || ENABLE_JAVASCRIPT_PATTERN.test(noscriptText),
    hasScripts,
    isNofollow: directives.has('nofollow') || directives.has('none'),
    isNoindex: directives.has('noindex') || directives.has('none'),
  };
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
    // unavailable_after: <date> has a colon too, but is a directive, not a scope.
    if (scoped !== null && scoped[1] !== 'unavailable_after') {
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
