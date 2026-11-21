import { describe, expect, it } from 'vitest';
import { cleanUrlForFetch, isInScope, isOnRelatedHost, normaliseUrl } from './normalise-url';

describe('normaliseUrl', () => {
  it.each([
    ['HTTPS://Example.COM/Docs/', 'https://example.com/Docs'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['http://example.com:80/', 'http://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
    ['https://example.com/a#section', 'https://example.com/a'],
    ['https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2'],
    ['https://example.com/a?utm_source=x&id=7&fbclid=y&gclid=z', 'https://example.com/a?id=7'],
    ['https://example.com/?utm_campaign=launch', 'https://example.com'],
    ['https://example.com/a///', 'https://example.com/a'],
    ['https://example.com/%7Euser', 'https://example.com/%7Euser'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseUrl(input)).toBe(expected);
  });

  it('resolves against a base URL', () => {
    expect(normaliseUrl('../b/', 'https://example.com/docs/a/')).toBe('https://example.com/docs/b');
  });

  it.each(['mailto:someone@example.com', 'javascript:void(0)', 'ftp://example.com/', 'not a url', 'https://user:pass@example.com/'])(
    'rejects %s',
    (input) => {
      expect(normaliseUrl(input)).toBeNull();
    },
  );
});

describe('cleanUrlForFetch', () => {
  it.each([
    // Only RFC 3986 safe normalisation: trailing slash and query order are the site's.
    ['HTTPS://Example.COM:443/Docs/', 'https://example.com/Docs/'],
    ['https://example.com/a/./b/../c', 'https://example.com/a/c'],
    ['https://example.com/a?b=2&a=1#top', 'https://example.com/a?b=2&a=1'],
    ['https://example.com/a?utm_source=x&id=7', 'https://example.com/a?id=7'],
    ['https://example.com/?utm_source=x', 'https://example.com/'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanUrlForFetch(input)).toBe(expected);
  });

  it('rejects what normaliseUrl rejects', () => {
    expect(cleanUrlForFetch('mailto:a@example.com')).toBeNull();
    expect(cleanUrlForFetch('https://user:pass@example.com/')).toBeNull();
  });
});

describe('isInScope', () => {
  it('accepts any path on a bare origin root', () => {
    expect(isInScope('https://example.com/anything', 'https://example.com')).toBe(true);
  });

  it('accepts the prefix itself and paths under it, on a segment boundary', () => {
    expect(isInScope('https://example.com/docs', 'https://example.com/docs')).toBe(true);
    expect(isInScope('https://example.com/docs/a', 'https://example.com/docs')).toBe(true);
    expect(isInScope('https://example.com/docs-old', 'https://example.com/docs')).toBe(false);
    expect(isInScope('https://example.com/blog', 'https://example.com/docs')).toBe(false);
  });

  it('rejects another scheme, host, subdomain or port', () => {
    expect(isInScope('http://example.com/a', 'https://example.com')).toBe(false);
    expect(isInScope('https://docs.example.com/a', 'https://example.com')).toBe(false);
    expect(isInScope('https://example.com:8443/a', 'https://example.com')).toBe(false);
  });
});

describe('isOnRelatedHost', () => {
  it('accepts other hosts under the site’s domain', () => {
    expect(isOnRelatedHost('https://docs.example.com/3/', 'https://www.example.com')).toBe(true);
    expect(isOnRelatedHost('https://example.com/a', 'https://www.example.com')).toBe(true);
    expect(isOnRelatedHost('https://docs.example.com/a', 'https://example.com')).toBe(true);
    expect(isOnRelatedHost('https://api.docs.example.com/a', 'https://docs.example.com')).toBe(true);
  });

  it('rejects the site’s own host, other sites, and siblings of a site on a subdomain', () => {
    expect(isOnRelatedHost('https://www.example.com/a', 'https://www.example.com')).toBe(false);
    expect(isOnRelatedHost('https://example.org/a', 'https://www.example.com')).toBe(false);
    expect(isOnRelatedHost('https://notexample.com/a', 'https://www.example.com')).toBe(false);
    expect(isOnRelatedHost('https://blog.example.com/a', 'https://docs.example.com')).toBe(false);
  });

  it('rejects another scheme or port, and sites addressed by IP or a bare name', () => {
    expect(isOnRelatedHost('http://docs.example.com/a', 'https://www.example.com')).toBe(false);
    expect(isOnRelatedHost('https://docs.example.com:8443/a', 'https://www.example.com')).toBe(false);
    expect(isOnRelatedHost('http://1.0.0.127:80/a', 'http://0.0.127')).toBe(false);
    expect(isOnRelatedHost('http://docs.localhost/a', 'http://localhost')).toBe(false);
  });
});
