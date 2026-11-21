import { describe, expect, it } from 'vitest';
import { parseWorkspaceExclusions } from './workspace-pages';

describe('parseWorkspaceExclusions', () => {
  it('stores each prefix as scheme, host and path with no trailing slash, query or fragment', () => {
    expect(
      parseWorkspaceExclusions({
        excludedUrls: ['https://example.com/pricing'],
        excludedUrlPrefixes: ['https://Example.com/blog/', 'https://example.com/blog?page=2#top', 'https://docs.example.com/'],
      }),
    ).toEqual({
      excludedUrls: ['https://example.com/pricing'],
      excludedUrlPrefixes: ['https://example.com/blog', 'https://docs.example.com'],
    });
  });

  it('refuses a body that is not two lists of URLs', () => {
    expect(parseWorkspaceExclusions(null)).toBeNull();
    expect(parseWorkspaceExclusions({ excludedUrls: [] })).toBeNull();
    expect(parseWorkspaceExclusions({ excludedUrls: 'https://example.com/a', excludedUrlPrefixes: [] })).toBeNull();
    expect(parseWorkspaceExclusions({ excludedUrls: [1], excludedUrlPrefixes: [] })).toBeNull();
    expect(parseWorkspaceExclusions({ excludedUrls: [], excludedUrlPrefixes: ['/blog'] })).toBeNull();
    expect(parseWorkspaceExclusions({ excludedUrls: [], excludedUrlPrefixes: ['javascript:alert(1)'] })).toBeNull();
    expect(parseWorkspaceExclusions({ excludedUrls: [], excludedUrlPrefixes: Array(501).fill('https://example.com/a') })).toBeNull();
  });
});
