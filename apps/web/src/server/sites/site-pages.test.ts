import { describe, expect, it } from 'vitest';
import { parsePageExclusions } from './site-pages';

describe('parsePageExclusions', () => {
  it('stores each prefix as scheme, host and path with no trailing slash, query or fragment', () => {
    expect(
      parsePageExclusions({
        excludedUrls: ['https://example.com/pricing'],
        excludedUrlPrefixes: ['https://Example.com/blog/', 'https://example.com/blog?page=2#top', 'https://docs.example.com/'],
      }),
    ).toEqual({
      excludedUrls: ['https://example.com/pricing'],
      excludedUrlPrefixes: ['https://example.com/blog', 'https://docs.example.com'],
    });
  });

  it('refuses a body that is not two lists of URLs', () => {
    expect(parsePageExclusions(null)).toBeNull();
    expect(parsePageExclusions({ excludedUrls: [] })).toBeNull();
    expect(parsePageExclusions({ excludedUrls: 'https://example.com/a', excludedUrlPrefixes: [] })).toBeNull();
    expect(parsePageExclusions({ excludedUrls: [1], excludedUrlPrefixes: [] })).toBeNull();
    expect(parsePageExclusions({ excludedUrls: [], excludedUrlPrefixes: ['/blog'] })).toBeNull();
    expect(parsePageExclusions({ excludedUrls: [], excludedUrlPrefixes: ['javascript:alert(1)'] })).toBeNull();
    expect(parsePageExclusions({ excludedUrls: [], excludedUrlPrefixes: Array(501).fill('https://example.com/a') })).toBeNull();
  });

  it('refuses a prefix that is too long once it is percent-encoded', () => {
    const excludedUrlPrefixes = [`https://example.com/${'文'.repeat(1_000)}`];
    expect(parsePageExclusions({ excludedUrls: [], excludedUrlPrefixes })).toBeNull();
  });
});
