import { load, type CheerioAPI } from 'cheerio/slim';
import type { Element } from 'domhandler';

// Sitemaps, in every format the protocol (sitemaps.org) allows: an XML <urlset> of pages,
// an XML <sitemapindex> of more sitemaps, a plain-text file of one URL per line, and RSS
// 2.0 or Atom feeds. Gzipped files are gunzipped by the fetcher before they get here.

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

  const feedEntries = readFeedEntries($, byLocalName);
  if (feedEntries !== null) return { kind: 'urlset', entries: feedEntries };

  const textEntries = readTextSitemap(xml);
  if (textEntries !== null) return { kind: 'urlset', entries: textEntries };

  return { kind: 'invalid' };
}

/** RSS 2.0 <item><link>, or Atom <entry><link href>; null if the document is neither. */
function readFeedEntries(
  $: CheerioAPI,
  byLocalName: (name: string) => ReturnType<CheerioAPI>,
): SitemapEntry[] | null {
  if (byLocalName('rss').length > 0) {
    return byLocalName('item')
      .toArray()
      .map((item) => {
        const children = $(item).children().toArray();
        const url = childText(children, 'link', $);
        return url === null ? null : { url, lastModified: childText(children, 'pubdate', $) };
      })
      .filter((entry): entry is SitemapEntry => entry !== null);
  }
  if (byLocalName('feed').length > 0) {
    return byLocalName('entry')
      .toArray()
      .map((entry) => {
        const children = $(entry).children().toArray();
        const link =
          children.find((child) => localName(child.tagName) === 'link' && ($(child).attr('rel') ?? 'alternate') === 'alternate') ??
          children.find((child) => localName(child.tagName) === 'link');
        const url = link === undefined ? null : ($(link).attr('href') ?? '').trim() || null;
        return url === null ? null : { url, lastModified: childText(children, 'updated', $) };
      })
      .filter((entry): entry is SitemapEntry => entry !== null);
  }
  return null;
}

/** One absolute URL per line; null unless every non-empty line is one. */
function readTextSitemap(text: string): SitemapEntry[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0 || !lines.every((line) => /^https?:\/\/\S+$/i.test(line))) return null;
  return lines.map((url) => ({ url, lastModified: null }));
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
