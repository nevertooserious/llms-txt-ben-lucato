import { describe, expect, it } from 'vitest';
import { assessSitemapLastModifiedTrust, type SitemapLastModifiedObservation } from './sitemap-trust';

const agreeing = (contentChanged: boolean): SitemapLastModifiedObservation => ({
  lastModifiedChanged: contentChanged,
  contentChanged,
});

describe('assessSitemapLastModifiedTrust', () => {
  it('trusts lastmod after enough agreeing observations, including a flagged change', () => {
    const observations = [agreeing(true), agreeing(false), agreeing(false), agreeing(false), agreeing(false)];
    expect(assessSitemapLastModifiedTrust(false, observations)).toBe(true);
  });

  it('withdraws trust when content changed under an unchanged lastmod', () => {
    const miss = { lastModifiedChanged: false, contentChanged: true };
    expect(assessSitemapLastModifiedTrust(true, [agreeing(true), miss])).toBe(false);
  });

  it('keeps the current answer when there is too little evidence', () => {
    expect(assessSitemapLastModifiedTrust(false, [agreeing(true)])).toBe(false);
    expect(assessSitemapLastModifiedTrust(true, [])).toBe(true);
    // Five observations but no change seen: lastmod has not yet shown it flags changes.
    expect(assessSitemapLastModifiedTrust(false, Array.from({ length: 5 }, () => agreeing(false)))).toBe(false);
  });
});
