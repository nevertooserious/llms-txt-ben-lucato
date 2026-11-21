import { describe, expect, it } from 'vitest';
import { parseSitemap } from './parse-sitemap';

describe('parseSitemap', () => {
  it('reads a urlset with lastmod', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc> https://example.com/ </loc><lastmod>2026-10-01</lastmod></url>
        <url><loc>https://example.com/a?x=1&amp;y=2</loc></url>
        <url><lastmod>2026-10-02</lastmod></url>
      </urlset>`;
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      entries: [
        { url: 'https://example.com/', lastModified: '2026-10-01' },
        { url: 'https://example.com/a?x=1&y=2', lastModified: null },
      ],
    });
  });

  it('reads a sitemap index', () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/s1.xml</loc></sitemap>
        <sitemap><loc>https://example.com/s2.xml</loc><lastmod>2026-01-01</lastmod></sitemap>
      </sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({
      kind: 'sitemapindex',
      sitemapUrls: ['https://example.com/s1.xml', 'https://example.com/s2.xml'],
    });
  });

  it('reads namespace-prefixed elements', () => {
    const xml = `<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://example.com/p</sm:loc></sm:url></sm:urlset>`;
    expect(parseSitemap(xml)).toEqual({ kind: 'urlset', entries: [{ url: 'https://example.com/p', lastModified: null }] });
  });

  it('reads a plain-text sitemap, one URL per line', () => {
    expect(parseSitemap('https://example.com/a\r\nhttps://example.com/b\n\n')).toEqual({
      kind: 'urlset',
      entries: [
        { url: 'https://example.com/a', lastModified: null },
        { url: 'https://example.com/b', lastModified: null },
      ],
    });
    expect(parseSitemap('https://example.com/a\nnot a url')).toEqual({ kind: 'invalid' });
  });

  it('reads an RSS 2.0 feed', () => {
    const rss = `<rss version="2.0"><channel><link>https://example.com/</link>
      <item><title>Post</title><link>https://example.com/post</link><pubDate>Sat, 21 Nov 2026 00:00:00 GMT</pubDate></item>
      </channel></rss>`;
    expect(parseSitemap(rss)).toEqual({
      kind: 'urlset',
      entries: [{ url: 'https://example.com/post', lastModified: 'Sat, 21 Nov 2026 00:00:00 GMT' }],
    });
  });

  it('reads an Atom feed, preferring the alternate link', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <link rel="edit" href="https://example.com/edit/1"/><link href="https://example.com/entry-1"/>
      <updated>2026-11-01T00:00:00Z</updated></entry></feed>`;
    expect(parseSitemap(atom)).toEqual({
      kind: 'urlset',
      entries: [{ url: 'https://example.com/entry-1', lastModified: '2026-11-01T00:00:00Z' }],
    });
  });

  it('reports anything else as invalid', () => {
    expect(parseSitemap('<!doctype html><html><body>Not a sitemap</body></html>')).toEqual({ kind: 'invalid' });
    expect(parseSitemap('')).toEqual({ kind: 'invalid' });
  });
});
