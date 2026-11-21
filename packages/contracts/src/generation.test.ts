import { describe, expect, it } from 'vitest';
import { isUrlUnderPrefix } from './generation';

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
