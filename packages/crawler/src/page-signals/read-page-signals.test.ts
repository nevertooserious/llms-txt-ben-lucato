import { describe, expect, it } from 'vitest';
import { readPageSignals, readXRobotsTag } from './read-page-signals';

const pageUrl = 'https://example.com/docs/page';

describe('readPageSignals', () => {
  it('resolves links against the page and <base href>, and finds navigation links', () => {
    const signals = readPageSignals(
      `<html><head><base href="https://example.com/root/"></head><body>
        <header><a href="/">Home</a></header>
        <nav><a href="guide">Guide</a></nav>
        <main><a href="https://other.example/x">Elsewhere</a><a href="/sponsor" rel="sponsored nofollow">Ad</a></main>
      </body></html>`,
      pageUrl,
    );
    expect(signals.linkUrls).toEqual(['https://example.com/', 'https://example.com/root/guide', 'https://other.example/x']);
    expect(signals.navigationLinks).toEqual([
      { url: 'https://example.com/', label: 'Home' },
      { url: 'https://example.com/root/guide', label: 'Guide' },
    ]);
  });

  it('labels a navigation link with its text, else its aria-label, and not with a sentence', () => {
    const signals = readPageSignals(
      `<body><nav>
        <a href="/downloads">  Down\n loads </a>
        <a href="/search" aria-label="Search"><svg></svg></a>
        <a href="/news">Read the announcement of everything that changed in this release</a>
      </nav></body>`,
      pageUrl,
    );
    expect(signals.navigationLinks.map((link) => link.label)).toEqual(['Down loads', 'Search', null]);
  });

  it('reads where a meta refresh redirects to, when it does so at once', () => {
    const refresh = (content: string) => readPageSignals(`<head><meta http-equiv="Refresh" content="${content}"></head>`, pageUrl).metaRefreshUrl;
    expect(refresh('0; url=/new/place.html')).toBe('https://example.com/new/place.html');
    expect(refresh("0;URL='https://other.example/x'")).toBe('https://other.example/x');
    expect(refresh('2; moved.html')).toBe('https://example.com/docs/moved.html');
    expect(refresh('30; url=/next-slide')).toBeNull();
    expect(refresh('60')).toBeNull();
    expect(readPageSignals('<body><p>No refresh.</p></body>', pageUrl).metaRefreshUrl).toBeNull();
  });

  it('counts visible body text only', () => {
    const signals = readPageSignals(
      `<html><head><title>Not counted</title></head><body><p>Hello   world</p>
        <script>var notCounted = 1;</script><style>.x{}</style><noscript>Not counted</noscript></body></html>`,
      pageUrl,
    );
    expect(signals.visibleTextLength).toBe('Hello world'.length);
  });

  it('spots an empty app root and a "please enable JavaScript" notice', () => {
    expect(readPageSignals('<body><div id="root"></div></body>', pageUrl).hasJavaScriptShellMarker).toBe(true);
    expect(readPageSignals('<body><div id="__next"><p>Rendered</p></div></body>', pageUrl).hasJavaScriptShellMarker).toBe(false);
    expect(
      readPageSignals('<body><noscript>Please enable JavaScript to use this site.</noscript></body>', pageUrl)
        .hasJavaScriptShellMarker,
    ).toBe(true);
  });

  it('counts executable scripts, not JSON-LD', () => {
    expect(readPageSignals('<body><script type="application/ld+json">{}</script></body>', pageUrl).hasScripts).toBe(false);
    expect(readPageSignals('<body><script src="/app.js"></script></body>', pageUrl).hasScripts).toBe(true);
    expect(readPageSignals('<body><script type="module">1</script></body>', pageUrl).hasScripts).toBe(true);
  });

  it('reads noindex from <meta name="robots"> and from a meta tag naming this crawler', () => {
    expect(readPageSignals('<head><meta name="robots" content="noindex"></head>', pageUrl).isNoindex).toBe(true);
    expect(readPageSignals('<head><meta name="LlmsTxtGenerator" content="noindex"></head>', pageUrl).isNoindex).toBe(true);
    expect(readPageSignals('<head><meta name="googlebot" content="noindex"></head>', pageUrl).isNoindex).toBe(false);
  });

  it('reads robots directives from X-Robots-Tag', () => {
    const signals = readPageSignals('<body><a href="/a">A</a></body>', pageUrl, { 'x-robots-tag': 'noindex, nofollow' });
    expect(signals).toMatchObject({ isNoindex: true, isNofollow: true });
  });

  it('reads a robots nofollow meta tag', () => {
    expect(readPageSignals('<head><meta name="robots" content="noindex, nofollow"></head>', pageUrl).isNofollow).toBe(true);
    expect(readPageSignals('<head><meta name="ROBOTS" content="none"></head>', pageUrl).isNofollow).toBe(true);
    expect(readPageSignals('<head><meta name="robots" content="noindex"></head>', pageUrl).isNofollow).toBe(false);
  });
});

describe('readXRobotsTag', () => {
  it('applies unscoped directives to every crawler', () => {
    expect(readXRobotsTag('noindex, nofollow')).toEqual(['noindex', 'nofollow']);
  });

  it('applies directives scoped to this crawler, and not to others', () => {
    expect(readXRobotsTag('googlebot: noindex, nofollow')).toEqual([]);
    expect(readXRobotsTag('LlmsTxtGenerator: noindex')).toEqual(['noindex']);
    expect(readXRobotsTag('googlebot: nofollow, llmstxtgenerator: noindex, noarchive')).toEqual(['noindex', 'noarchive']);
  });

  it('treats unavailable_after as a directive, not a scope', () => {
    expect(readXRobotsTag('unavailable_after: 25 Jun 2030 15:00:00 PST')).toEqual(['unavailable_after: 25 jun 2030 15:00:00 pst']);
  });

  it('treats the max-* directives as directives too, so those after them still apply', () => {
    expect(readXRobotsTag('max-snippet:-1, max-image-preview: large, noindex')).toEqual([
      'max-snippet:-1',
      'max-image-preview: large',
      'noindex',
    ]);
    expect(readXRobotsTag('googlebot: max-video-preview:0, nofollow')).toEqual([]);
  });
});
