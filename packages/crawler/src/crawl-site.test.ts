import { describe, expect, it } from 'vitest';
import { machineReadableResourceKindOf } from '@llms-txt/contracts';
import { htmlUrlForMarkdownLink, markdownVariantUrlFor, parseRetryAfter } from './crawl-site';

// crawlSite itself runs against fixture sites in e2e/tests/crawler.test.ts.

describe('markdownVariantUrlFor', () => {
  it.each([
    ['https://example.com', 'https://example.com/index.html.md'],
    ['https://example.com/docs/', 'https://example.com/docs/index.html.md'],
    ['https://example.com/docs/intro', 'https://example.com/docs/intro.md'],
    ['https://example.com/page.html', 'https://example.com/page.html.md'],
  ])('%s -> %s', (pageUrl, expected) => {
    expect(markdownVariantUrlFor(pageUrl)).toBe(expected);
  });

  it('does not probe query URLs or markdown URLs', () => {
    expect(markdownVariantUrlFor('https://example.com/search?q=x')).toBeNull();
    expect(markdownVariantUrlFor('https://example.com/a.md')).toBeNull();
  });
});

describe('machineReadableResourceKindOf', () => {
  it.each([
    ['https://example.com/llms-full.txt', 'llms_full_txt'],
    ['https://example.com/workers/llms.txt', 'llms_txt_index'],
    ['https://example.com/api/OpenAPI.yaml?v=2', 'openapi_description'],
    ['https://example.com/swagger.json', 'openapi_description'],
    ['https://example.com/docs/openapi', null],
    ['https://example.com/notes.txt', null],
    ['not a url', null],
  ])('%s -> %s', (url, expected) => {
    expect(machineReadableResourceKindOf(url)).toBe(expected);
  });
});

describe('htmlUrlForMarkdownLink', () => {
  it.each([
    ['/guides/setup.md', 'https://example.com/guides/setup'],
    ['/docs/index.html.md', 'https://example.com/docs/'],
    ['/plain', 'https://example.com/plain'],
    ['https://other.example/x.md', 'https://other.example/x'],
  ])('%s -> %s', (href, expected) => {
    expect(htmlUrlForMarkdownLink(href, 'https://example.com/llms.txt')).toBe(expected);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-21T00:00:00Z');

  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('3', now)).toBe(3000);
    expect(parseRetryAfter('Sat, 21 Nov 2026 00:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('Fri, 20 Nov 2026 23:00:00 GMT', now)).toBe(0);
  });

  it('returns null when absent or unreadable', () => {
    expect(parseRetryAfter(undefined, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});
