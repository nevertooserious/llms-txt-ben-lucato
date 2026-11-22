import { describe, expect, it } from 'vitest';
import type { GeneratorPage } from '@llms-txt/contracts';
import { entryTitle, siteNameFrom } from './index';

function innerPage(title: string | null, path = '/page'): GeneratorPage {
  const normalisedUrl = `https://example.com${path}`;
  return {
    record: {
      normalisedUrl,
      canonicalUrl: null,
      title,
      description: null,
      declaredSiteName: null,
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
      navigationLabel: null,
      navigationPosition: null,
      firstLinkPosition: null,
    },
    markdownVariantUrl: null,
    outboundLinkUrls: [],
  };
}

describe('siteNameFrom', () => {
  it('takes the part of the homepage title that other pages end with', () => {
    const pages = [innerPage('Changes – Acme'), innerPage('Setup – Acme')];
    expect(siteNameFrom('The guide, v2 – Acme', pages)).toBe('Acme');
  });

  it('reads a title divided by a bullet, as svelte.dev writes them', () => {
    const pages = [innerPage('Docs • Svelte'), innerPage('Packages • Svelte'), innerPage('Routing • SvelteKit Docs')];
    expect(siteNameFrom('Svelte • Web development for the rest of us', pages)).toBe('Svelte');
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

  it('takes the name the homepage declares before anything in its title', () => {
    const homepage = innerPage('Welcome to Acme', '/');
    homepage.record.declaredSiteName = 'Acme';
    homepage.crawlSignals.crawlDepth = 0;
    expect(siteNameFrom('Welcome to Acme', [homepage, innerPage('Docs | Something else')])).toBe('Acme');
  });

  it('takes the name from the middle of a title, and ignores a declared name that is the whole title', () => {
    const tagline = 'A progressive framework';
    const homepage = innerPage(`Documentation | Acme - ${tagline}`, '/');
    homepage.record.declaredSiteName = `Documentation | Acme - ${tagline}`;
    homepage.crawlSignals.crawlDepth = 0;
    const pages = [homepage, innerPage(`Controllers | Acme - ${tagline}`), innerPage(`Providers | Acme - ${tagline}`)];
    expect(siteNameFrom(`Documentation | Acme - ${tagline}`, pages)).toBe('Acme');
  });

  it('takes the name most other pages end with when the homepage title does not hold it', () => {
    const pages = [innerPage('Downloads | Acme'), innerPage('Docs | Acme'), innerPage('Our community | Acme'), innerPage('Untitled')];
    expect(siteNameFrom('Welcome to Acme.org', pages)).toBe('Acme');
    expect(siteNameFrom('Welcome to Acme.org', [innerPage('Docs | Acme'), innerPage('Pricing'), innerPage('About')])).toBe(
      'Welcome to Acme.org',
    );
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
