import { describe, expect, it } from 'vitest';
import { readPageSignals } from './read-page-signals';

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
    expect(signals.navigationLinkUrls).toEqual(['https://example.com/', 'https://example.com/root/guide']);
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

  it('reads a robots nofollow meta tag', () => {
    expect(readPageSignals('<head><meta name="robots" content="noindex, nofollow"></head>', pageUrl).isNofollow).toBe(true);
    expect(readPageSignals('<head><meta name="ROBOTS" content="none"></head>', pageUrl).isNofollow).toBe(true);
    expect(readPageSignals('<head><meta name="robots" content="noindex"></head>', pageUrl).isNofollow).toBe(false);
  });
});
