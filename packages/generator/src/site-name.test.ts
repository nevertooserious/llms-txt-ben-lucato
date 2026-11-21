import { describe, expect, it } from 'vitest';
import type { GeneratorPage } from '@llms-txt/contracts';
import { entryTitle, siteNameFrom } from './generate-llms-txt';

function innerPage(title: string | null, path = '/page'): GeneratorPage {
  const normalisedUrl = `https://example.com${path}`;
  return {
    record: {
      normalisedUrl,
      canonicalUrl: null,
      title,
      description: null,
      pageType: 'other',
      languageCode: null,
      contentMarkdown: '',
      contentDigest: 'digest',
      listingFieldsHash: 'hash',
    },
    assessment: null,
    fetchUrl: normalisedUrl,
    crawlSignals: {
      crawlDepth: 1,
      discoveredVia: 'navigation',
      hasNoindexDirective: false,
      isInSiteNavigation: false,
      inboundLinkCount: 0,
    },
    markdownVariantUrl: null,
  };
}

describe('siteNameFrom', () => {
  it('takes the part of the homepage title that other pages end with', () => {
    const pages = [innerPage('Changes – Acme'), innerPage('Setup – Acme')];
    expect(siteNameFrom('The guide, v2 – Acme', pages)).toBe('Acme');
  });

  it('takes the part that other pages start with', () => {
    const pages = [innerPage('Acme | Changes'), innerPage('Acme | Setup')];
    expect(siteNameFrom('Acme | Build faster', pages)).toBe('Acme');
  });

  it('keeps the whole title when too few pages share a part', () => {
    expect(siteNameFrom('Build faster - ship more', [innerPage('Pricing - ship more')])).toBe('Build faster - ship more');
  });

  it('does not count copies of the homepage as evidence', () => {
    const copies = [innerPage('The guide – Acme', '/index'), innerPage('The guide – Acme', '/index.html')];
    expect(siteNameFrom('The guide – Acme', copies)).toBe('The guide – Acme');
  });

  it('leaves a title with no separator alone', () => {
    expect(siteNameFrom('Acme', [innerPage('Changes – Acme'), innerPage('Setup – Acme')])).toBe('Acme');
  });
});

describe('entryTitle', () => {
  it('drops the site name from either end', () => {
    expect(entryTitle(innerPage('Docs | Acme'), 'Acme')).toBe('Docs');
    expect(entryTitle(innerPage('Acme | Docs'), 'Acme')).toBe('Docs');
  });
});
