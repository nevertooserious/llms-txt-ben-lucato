import type { GeneratorPage, PageType } from '@llms-txt/contracts';
import { describe, expect, it } from 'vitest';
import { generateLlmsTxt } from './generate-llms-txt';
import { validateLlmsTxt } from './validate-llms-txt';

const page = (
  url: string,
  options: { title?: string; description?: string | null; pageType?: PageType; depth?: number; noindex?: boolean } = {},
): GeneratorPage => ({
  record: {
    normalisedUrl: url,
    canonicalUrl: null,
    title: options.title ?? 'Title',
    description: options.description ?? null,
    pageType: options.pageType ?? 'other',
    languageCode: 'en',
    contentMarkdown: '',
    contentDigest: '',
    listingFieldsHash: '',
  },
  crawlSignals: {
    crawlDepth: options.depth ?? 1,
    discoveredVia: 'navigation',
    hasNoindexDirective: options.noindex ?? false,
    isInSiteNavigation: true,
    inboundLinkCount: 1,
  },
  markdownVariantUrl: null,
});

// The renderer is a stub (see generate-llms-txt.ts); these cover what it does today.
describe('generateLlmsTxt (stub)', () => {
  it('renders valid text with sections by page type, applying overrides', () => {
    const text = generateLlmsTxt({
      siteTitle: 'Example',
      siteSummary: 'A site.',
      pages: [
        page('https://example.com/docs', { title: 'Docs [v2]', pageType: 'docs', description: 'Old' }),
        page('https://example.com/hidden', { noindex: true }),
        page('https://example.com/gone'),
        page('https://example.com/a/b/c', { title: 'Deep', depth: 3 }),
      ],
      overrides: [
        { normalisedUrl: 'https://example.com/docs', descriptionOverride: 'New', isExcluded: false },
        { normalisedUrl: 'https://example.com/gone', descriptionOverride: null, isExcluded: true },
      ],
    });
    expect(text).toBe(
      [
        '# Example',
        '',
        '> A site.',
        '',
        '## Docs',
        '',
        '- [Docs \\[v2\\]](https://example.com/docs): New',
        '',
        '## Optional',
        '',
        '- [Deep](https://example.com/a/b/c)',
        '',
      ].join('\n'),
    );
    expect(validateLlmsTxt(text)).toEqual({ isValid: true, problems: [] });
  });

  it.todo('puts low-scoring pages under an H2 named Optional');
  it.todo('links the .md variant when one exists');
});

describe('validateLlmsTxt', () => {
  it('accepts a file with only an H1', () => {
    expect(validateLlmsTxt('# Example\n').isValid).toBe(true);
  });

  it('rejects H3 headings', () => {
    expect(validateLlmsTxt('# Example\n\n## Docs\n\n### Sub\n').isValid).toBe(false);
  });

  it('rejects entries that are not one link line', () => {
    expect(validateLlmsTxt('# Example\n\n## Docs\n\n- [A](https://a.example)\ncontinued\n').isValid).toBe(false);
  });
});
