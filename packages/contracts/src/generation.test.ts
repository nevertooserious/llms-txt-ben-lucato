import { describe, expect, it } from 'vitest';
import { fragmentRoutePathOf, isUrlUnderPrefix, pagePathOf } from './generation';

describe('isUrlUnderPrefix', () => {
  const prefix = 'https://example.com/blog';

  it('covers the prefix itself and everything under it', () => {
    expect(isUrlUnderPrefix('https://example.com/blog', prefix)).toBe(true);
    expect(isUrlUnderPrefix('https://example.com/blog/', prefix)).toBe(true);
    expect(isUrlUnderPrefix('https://example.com/blog/2024/post?page=2', prefix)).toBe(true);
  });

  it('matches whole path segments, on the same origin', () => {
    expect(isUrlUnderPrefix('https://example.com/blog-archive', prefix)).toBe(false);
    expect(isUrlUnderPrefix('https://example.com/docs/blog', prefix)).toBe(false);
    expect(isUrlUnderPrefix('https://other.example.com/blog/post', prefix)).toBe(false);
    expect(isUrlUnderPrefix('http://example.com/blog/post', prefix)).toBe(false);
  });

  it('covers a whole host when the prefix has no path', () => {
    expect(isUrlUnderPrefix('https://docs.example.com', 'https://docs.example.com')).toBe(true);
    expect(isUrlUnderPrefix('https://docs.example.com/api/auth', 'https://docs.example.com/')).toBe(true);
    expect(isUrlUnderPrefix('https://example.com/api', 'https://docs.example.com')).toBe(false);
  });

  it('is false for text that is not a URL', () => {
    expect(isUrlUnderPrefix('not a url', prefix)).toBe(false);
    expect(isUrlUnderPrefix('https://example.com/blog', '/blog')).toBe(false);
  });
});

describe('fragmentRoutePathOf', () => {
  it.each([
    ['https://example.com/#/install', '/install'],
    ['https://example.com/#!/install', '/install'],
    ['https://example.com/#/guide/setup/', '/guide/setup'],
    ['https://example.com/#/install?id=usage', '/install'],
    ['https://example.com/docs/#/install', '/install'],
    ['https://example.com/#/./install', '/install'],
    ['https://example.com/#/guide/../install', '/install'],
    ['https://example.com/#//install', '/install'],
  ])('reads the route of %s', (url, expected) => {
    expect(fragmentRoutePathOf(new URL(url))).toBe(expected);
  });

  it.each([
    'https://example.com/',
    'https://example.com/#/',
    'https://example.com/#!/',
    'https://example.com/#/?id=top',
    'https://example.com/#/./',
    'https://example.com/page#section',
    'https://example.com/page#install',
  ])('finds no route in %s', (url) => {
    expect(fragmentRoutePathOf(new URL(url))).toBe('');
  });
});

describe('pagePathOf', () => {
  it('is the path, then the route in the fragment', () => {
    expect(pagePathOf(new URL('https://example.com/docs/guide/'))).toBe('/docs/guide');
    expect(pagePathOf(new URL('https://example.com/#/install'))).toBe('/install');
    expect(pagePathOf(new URL('https://example.com/docs#/guide/setup'))).toBe('/docs/guide/setup');
    expect(pagePathOf(new URL('https://example.com'))).toBe('');
  });
});

describe('isUrlUnderPrefix, on a site that routes on the URL fragment', () => {
  it('reads the route as path, so a route prefix covers the routes under it and no others', () => {
    const prefix = 'https://example.com/#/guide';
    expect(isUrlUnderPrefix('https://example.com/#/guide', prefix)).toBe(true);
    expect(isUrlUnderPrefix('https://example.com/#/guide/setup', prefix)).toBe(true);
    expect(isUrlUnderPrefix('https://example.com/#/guides', prefix)).toBe(false);
    expect(isUrlUnderPrefix('https://example.com/#/install', prefix)).toBe(false);
    expect(isUrlUnderPrefix('https://example.com', prefix)).toBe(false);
  });
});
