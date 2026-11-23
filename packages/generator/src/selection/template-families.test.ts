import { describe, expect, it } from 'vitest';
import type { GeneratorPage, PageType } from '@llms-txt/contracts';
import { pagesBeyondAddressFamilySample, pagesBeyondTemplateFamilySample } from './template-families';

const ORIGIN = 'https://example.com';

function page(
  path: string,
  title: string,
  { scope = 'narrow', pageType = 'other' }: { scope?: 'narrow' | 'broad'; pageType?: Exclude<PageType, 'home'> } = {},
): GeneratorPage {
  return {
    record: {
      normalisedUrl: `${ORIGIN}${path}`,
      canonicalUrl: null,
      title,
      description: null,
      declaredSiteName: null,
      pageType,
      languageCode: null,
      contentMarkdown: '',
      contentDigest: `digest of ${path}`,
      listingFieldsHash: 'hash',
    },
    assessment: { description: '', listingValue: 'primary', exclusionReason: null, scope, pageType, sourceHash: 'source' },
    fetchUrl: `${ORIGIN}${path}`,
    crawlSignals: {
      crawlDepth: 1,
      discoveredVia: 'sitemap',
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

const STATES = ['Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Delaware', 'Florida', 'Georgia', 'New York', 'District of Columbia'];
const pathsOf = (pages: readonly GeneratorPage[]) => pages.map((entry) => new URL(entry.record.normalisedUrl).pathname);

describe('pagesBeyondTemplateFamilySample', () => {
  it('keeps the first three pages whose titles differ in one place, however their URLs differ', () => {
    const statePages = STATES.map((state, index) => page(`/tax-${index}/${state.toLowerCase().replaceAll(' ', '-')}`, `${state} Income Tax 2026: Rates & Calculator | TaxCalc`));
    const others = ['About', 'Glossary', 'Methodology', 'Contact'].map((name) => page(`/${name.toLowerCase()}`, `${name} | TaxCalc`));
    const beyond = pagesBeyondTemplateFamilySample([...others, ...statePages]);
    expect(beyond).toEqual(statePages.slice(3));
  });

  it('does not take the site’s name, which every title carries, for a template', () => {
    const titles = ['Rules', 'Hooks', 'Skills', 'Plugins', 'Subagents', 'Bugbot', 'Automations', 'Deeplinks', 'Rollouts', 'Changelog'];
    const pages = titles.map((title) => page(`/docs/${title.toLowerCase()}`, `${title} | Acme Cloud Docs`));
    expect(pagesBeyondTemplateFamilySample(pages)).toEqual([]);
    const nameFirst = titles.map((title) => page(`/docs/${title.toLowerCase()}`, `Acme Cloud Docs - ${title}`));
    expect(pagesBeyondTemplateFamilySample(nameFirst)).toEqual([]);
  });

  it('leaves alone a site whose titles nearly all share their words', () => {
    // Then the words are the site's own, and nothing marks out a family within it.
    const statePages = STATES.map((state) => page(`/tax/${state}`, `${state} Income Tax 2026`));
    expect(pagesBeyondTemplateFamilySample([page('/about', 'About'), ...statePages])).toEqual([]);
  });

  it('leaves alone titles that share only common words, and families of fewer than eight', () => {
    const howTos = ['install', 'deploy', 'test', 'debug', 'profile', 'publish', 'upgrade', 'migrate', 'configure'].map((verb) =>
      page(`/guides/${verb}`, `How to ${verb}`),
    );
    const fewStates = STATES.slice(0, 7).map((state) => page(`/tax/${state}`, `${state} Income Tax 2026`));
    expect(pagesBeyondTemplateFamilySample([...howTos, ...fewStates])).toEqual([]);
  });
});

describe('pagesBeyondAddressFamilySample', () => {
  const cities = ['sofia', 'helsinki', 'nairobi', 'dubai', 'geneva', 'auckland', 'bucharest', 'tirana', 'vienna'];

  it('samples the narrow pages of one directory, whatever their titles', () => {
    const products = cities.map((city, index) => page(`/products/esim-${city}-${index}gb`, `An eSIM for ${city}, ${index} GB`));
    expect(pathsOf(pagesBeyondAddressFamilySample([page('/pricing', 'Pricing'), ...products]))).toEqual(pathsOf(products.slice(3)));
  });

  it('samples pages at addresses that differ in one place across directories', () => {
    const locations = cities.map((city, index) => page(`/dedicated-servers-country${index}/${city}`, `Servers, hand-titled ${index}`));
    expect(pathsOf(pagesBeyondAddressFamilySample(locations))).toEqual(pathsOf(locations.slice(3)));
  });

  it('leaves whole a directory of broad pages, and one of documentation', () => {
    const features = cities.map((city) => page(`/features/${city}`, `Feature ${city}`, { scope: 'broad' }));
    const chapters = cities.map((city) => page(`/manual/chapters/${city}`, `Chapter ${city}`, { pageType: 'docs' }));
    expect(pagesBeyondAddressFamilySample([...features, ...chapters])).toEqual([]);
  });
});
