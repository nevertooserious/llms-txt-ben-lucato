import { describe, expect, it } from 'vitest';
import type { PageSignals } from './read-page-signals';
import { looksLikeJavaScriptShell, renderedPageIsBetter, renderingAddsContent } from './render-decision';

const signals = (overrides: Partial<PageSignals>): PageSignals => ({
  linkUrls: [],
  navigationLinks: [],
  metaRefreshUrl: null,
  visibleTextLength: 0,
  hasJavaScriptShellMarker: false,
  hasScripts: true,
  isNofollow: false,
  isNoindex: false,
  ...overrides,
});
const links = (count: number) => Array.from({ length: count }, (_unused, index) => `https://example.com/${index}`);

describe('renderingAddsContent', () => {
  it('is true when rendering turns an empty shell into a page', () => {
    expect(renderingAddsContent(signals({}), signals({ visibleTextLength: 800, linkUrls: links(4) }))).toBe(true);
  });

  it('is true when rendering adds a menu of links', () => {
    expect(
      renderingAddsContent(signals({ visibleTextLength: 900, linkUrls: links(2) }), signals({ visibleTextLength: 950, linkUrls: links(12) })),
    ).toBe(true);
  });

  it('counts distinct pages of the site, not repeated links or links elsewhere', () => {
    const plain = signals({ visibleTextLength: 4000, linkUrls: links(30) });
    // A script-built menu repeating links the HTML already has (kubernetes.io).
    expect(renderingAddsContent(plain, signals({ visibleTextLength: 4400, linkUrls: [...links(30), ...links(30)] }))).toBe(false);
    // The same pages under fragments and with a trailing slash.
    const sameLinksWrittenDifferently = links(30).flatMap((url) => [`${url}#top`, `${url}/`]);
    expect(renderingAddsContent(plain, signals({ visibleTextLength: 4400, linkUrls: sameLinksWrittenDifferently }))).toBe(false);
    // Sponsors' sites loaded by script (sqlite.org).
    const sponsors = Array.from({ length: 8 }, (_unused, index) => `https://sponsor-${index}.example/`);
    const isOnSite = (url: string) => url.startsWith('https://example.com');
    expect(renderingAddsContent(plain, signals({ visibleTextLength: 4400, linkUrls: [...links(30), ...sponsors] }), isOnSite)).toBe(false);
  });

  it('is false when rendering adds a few links to a page that already has many', () => {
    expect(
      renderingAddsContent(signals({ visibleTextLength: 12000, linkUrls: links(100) }), signals({ visibleTextLength: 14000, linkUrls: links(110) })),
    ).toBe(false);
  });

  it('is false for a hydrated page whose text barely changes', () => {
    expect(
      renderingAddsContent(signals({ visibleTextLength: 2000, linkUrls: links(10) }), signals({ visibleTextLength: 2150, linkUrls: links(12) })),
    ).toBe(false);
  });

  it('needs both an absolute and a relative gain in text', () => {
    // +300 characters, but only 1.15x: a cookie banner on a long page.
    expect(renderingAddsContent(signals({ visibleTextLength: 2000 }), signals({ visibleTextLength: 2300 }))).toBe(false);
    // 3x, but only +100 characters.
    expect(renderingAddsContent(signals({ visibleTextLength: 50 }), signals({ visibleTextLength: 150 }))).toBe(false);
  });
});

describe('looksLikeJavaScriptShell', () => {
  it('is true for an empty page with scripts', () => {
    expect(looksLikeJavaScriptShell(signals({ visibleTextLength: 10 }))).toBe(true);
  });

  it('is true for an empty app root, even with some surrounding text', () => {
    expect(looksLikeJavaScriptShell(signals({ visibleTextLength: 400, linkUrls: links(5), hasJavaScriptShellMarker: true }))).toBe(true);
  });

  it('is false for a short page that has real content', () => {
    expect(looksLikeJavaScriptShell(signals({ visibleTextLength: 120, linkUrls: links(1) }))).toBe(false);
  });

  it('is false without scripts, since rendering could not add anything', () => {
    expect(looksLikeJavaScriptShell(signals({ visibleTextLength: 0, hasScripts: false }))).toBe(false);
  });
});

describe('renderedPageIsBetter', () => {
  it('keeps the rendered page only when it shows more', () => {
    expect(renderedPageIsBetter(signals({ visibleTextLength: 10 }), signals({ visibleTextLength: 200 }))).toBe(true);
    expect(renderedPageIsBetter(signals({ visibleTextLength: 200 }), signals({ visibleTextLength: 200 }))).toBe(false);
  });
});
