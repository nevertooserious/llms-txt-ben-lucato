import { load, type CheerioAPI } from 'cheerio/slim';
import type { Element } from 'domhandler';

// Sitemaps (sitemaps.org): a <urlset> lists pages, a <sitemapindex> lists more sitemaps.
// Gzipped sitemaps are not supported; their fetch fails on content type and is skipped.

export interface SitemapEntry {
  url: string;
  /** The raw <lastmod> value, or null. */
  lastModified: string | null;
}

export type ParsedSitemap =
  | { kind: 'urlset'; entries: SitemapEntry[] }
  | { kind: 'sitemapindex'; sitemapUrls: string[] }
  | { kind: 'invalid' };

export function parseSitemap(xml: string): ParsedSitemap {
  const $ = load(xml, { xml: true });
  // Match on local names, so a namespace prefix such as <sm:urlset> still parses.
  const byLocalName = (name: string) => $('*').filter((_index, element) => 'tagName' in element && localName(element.tagName) === name);

  if (byLocalName('sitemapindex').length > 0) {
    const sitemapUrls = byLocalName('sitemap')
      .map((_index, element) => childText($(element).children().toArray(), 'loc', $))
      .get()
      .filter((url): url is string => url !== null);
    return { kind: 'sitemapindex', sitemapUrls };
  }

  if (byLocalName('urlset').length > 0) {
    const entries: SitemapEntry[] = [];
    byLocalName('url').each((_index, element) => {
      const children = $(element).children().toArray();
      const url = childText(children, 'loc', $);
      if (url !== null) entries.push({ url, lastModified: childText(children, 'lastmod', $) });
    });
    return { kind: 'urlset', entries };
  }

  return { kind: 'invalid' };
}

function localName(tagName: string): string {
  const colon = tagName.indexOf(':');
  return (colon === -1 ? tagName : tagName.slice(colon + 1)).toLowerCase();
}

function childText(children: Element[], name: string, $: CheerioAPI): string | null {
  const child = children.find((element) => localName(element.tagName) === name);
  if (child === undefined) return null;
  const text = $(child).text().trim();
  return text === '' ? null : text;
}
