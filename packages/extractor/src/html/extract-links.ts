import { documentBaseUrl, parseHtml, resolveUrl } from './parse-html';

/**
 * Absolute http(s) URLs of every <a href> in the document, resolved against <base href>
 * or else baseUrl. Fragments are dropped and duplicates removed, in document order.
 * mailto:, tel:, javascript: and other schemes are skipped. Scope and normalisation
 * are the crawler's job.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = parseHtml(html);
  const resolutionBase = documentBaseUrl($, baseUrl);
  const links = new Set<string>();
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const absoluteUrl = href === undefined ? null : resolveUrl(href, resolutionBase);
    if (!absoluteUrl) return;
    const url = new URL(absoluteUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    links.add(url.href);
  });
  return [...links];
}
