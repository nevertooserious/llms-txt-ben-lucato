import type { Cheerio, CheerioAPI } from 'cheerio/slim';
import type { AnyNode, Element } from 'domhandler';

/** Never content: code, media, embeds and form controls. */
const NON_CONTENT_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'img',
  'picture',
  'video',
  'audio',
  'button',
  'input',
  'select',
  'textarea',
  'dialog',
  '[hidden]',
  '[aria-hidden="true"]',
].join(', ');

/** Page chrome around the content. Removed from <body> when there is no content element. */
const PAGE_CHROME_SELECTOR =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';

/**
 * Chrome that also appears inside content elements (breadcrumbs, tables of contents,
 * sidebars). An <article>'s own <header> holds its title, so header stays.
 */
const IN_CONTENT_CHROME_SELECTOR = 'nav, aside, [role="navigation"], [role="complementary"]';

/** Block elements whose text counts as prose when looking for the densest container. */
const PROSE_SELECTOR = 'p, pre, blockquote, dd';

/** Below this much prose, a page has no densest container worth trusting. */
const MINIMUM_PROSE_LENGTH = 200;

/** A container must hold at least this share of the page's prose to be chosen. */
const DENSEST_CONTAINER_PROSE_SHARE = 0.8;

/** Removes elements that are never content. Mutates the document. */
export function removeNonContent($: CheerioAPI): void {
  $(NON_CONTENT_SELECTOR).remove();
}

/**
 * The element holding the page's main content, in order of preference:
 *
 * 1. <main> or [role=main], when it has text.
 * 2. The only top-level <article>. Several articles means a listing, not one article.
 * 3. The densest container: the smallest element holding most of the page's prose,
 *    found after removing page chrome. This finds the content in client-rendered
 *    apps, whose markup is often all <div>s.
 * 4. <body> without nav, header, footer and aside (an article's own header and
 *    footer stay).
 *
 * Call removeNonContent first. Mutates the document: chrome is removed.
 */
export function selectMainContent($: CheerioAPI): Cheerio<Element> {
  const semanticMain = $('main, [role="main"]')
    .filter((_, element) => $(element).text().trim() !== '')
    .first();
  if (semanticMain.length > 0) return withoutInContentChrome(semanticMain);

  const topLevelArticles = $('article').filter((_, element) => $(element).parents('article').length === 0);
  if (topLevelArticles.length === 1) return withoutInContentChrome(topLevelArticles);

  // An article's own header and footer hold its title and byline, not page chrome.
  $(PAGE_CHROME_SELECTOR)
    .filter((_, element) => $(element).closest('article').length === 0)
    .remove();
  const body = $('body');
  return withoutInContentChrome(findDensestContainer($, body) ?? body);
}

function withoutInContentChrome(content: Cheerio<Element>): Cheerio<Element> {
  content.find(IN_CONTENT_CHROME_SELECTOR).remove();
  return content;
}

/**
 * Walks down from root into the child holding at least 80% of the prose (text in
 * paragraphs, code blocks and quotes, minus link text), and stops where no child
 * does. It never walks past the first <h1>, so the page title stays with its content.
 * Returns null when the walk does not leave root.
 */
function findDensestContainer($: CheerioAPI, root: Cheerio<Element>): Cheerio<Element> | null {
  const rootElement = root[0];
  if (!rootElement) return null;

  const proseLengthByAncestor = new Map<AnyNode, number>();
  let totalProseLength = 0;
  root.find(PROSE_SELECTOR).each((_, element) => {
    const block = $(element);
    if (block.parents(PROSE_SELECTOR).length > 0) return;
    const proseLength = Math.max(0, visibleLength(block.text()) - visibleLength(block.find('a').text()));
    if (proseLength === 0) return;
    totalProseLength += proseLength;
    for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
      proseLengthByAncestor.set(ancestor, (proseLengthByAncestor.get(ancestor) ?? 0) + proseLength);
    }
  });
  if (totalProseLength < MINIMUM_PROSE_LENGTH) return null;

  const titleAncestors = new Set<AnyNode>();
  for (let ancestor = root.find('h1')[0]?.parent; ancestor; ancestor = ancestor.parent) {
    titleAncestors.add(ancestor);
  }

  let current: Element = rootElement;
  for (;;) {
    const holdsTitle = titleAncestors.has(current);
    const next = current.children.find(
      (child): child is Element =>
        child.type === 'tag' &&
        (proseLengthByAncestor.get(child) ?? 0) >= DENSEST_CONTAINER_PROSE_SHARE * totalProseLength &&
        (!holdsTitle || titleAncestors.has(child)),
    );
    if (!next) break;
    current = next;
  }
  return current === rootElement ? null : $(current);
}

function visibleLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}
