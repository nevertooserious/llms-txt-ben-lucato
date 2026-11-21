import { load, type CheerioAPI } from 'cheerio/slim';
import { parse } from 'parse5';
import { adapter } from 'parse5-htmlparser2-tree-adapter';

/**
 * Parses HTML the way a browser does (parse5 follows the WHATWG algorithm, so
 * malformed markup is repaired, not rejected) and returns a Cheerio query function.
 *
 * Uses cheerio/slim on a parse5 tree because the main cheerio entry also bundles an
 * HTTP client for fetching documents, which the extractor must not import.
 */
export function parseHtml(html: string): CheerioAPI {
  return load(parse(html, { treeAdapter: adapter }));
}

/** Collapses runs of whitespace to one space and trims. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Collapsed text, or null when nothing is left. */
export function nonEmptyText(text: string | undefined): string | null {
  if (text === undefined) return null;
  const collapsed = collapseWhitespace(text);
  return collapsed === '' ? null : collapsed;
}

/** Resolves a URL against a base; null when it does not parse. */
export function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href.trim(), baseUrl).href;
  } catch {
    return null;
  }
}

/** The document's base URL: <base href> resolved against the page URL, else the page URL. */
export function documentBaseUrl($: CheerioAPI, pageUrl: string): string {
  const baseHref = $('base[href]').first().attr('href');
  return (baseHref && resolveUrl(baseHref, pageUrl)) || pageUrl;
}
