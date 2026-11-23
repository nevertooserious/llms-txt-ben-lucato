import { describe, expect, it } from 'vitest';
import { createStubLlmClient } from './stub-llm-client';

const input = {
  url: 'https://example.com/docs',
  title: 'Docs',
  metaDescription: 'The docs.',
  isInSiteNavigation: false,
  contentMarkdown: '',
};

describe('createStubLlmClient', () => {
  it('keeps the page and repeats what the crawl found', async () => {
    expect(await createStubLlmClient().assessPage({ ...input, urlBasedPageType: 'docs' })).toEqual({
      description: 'The docs.',
      listingValue: 'primary',
      exclusionReason: null, scope: 'broad',
      pageType: 'docs',
    });
  });

  it('answers with a type an assessment may have', async () => {
    expect((await createStubLlmClient().assessPage({ ...input, urlBasedPageType: 'home' })).pageType).toBe('other');
  });

  it('uses the homepage description as the summary, with no notes', async () => {
    const summary = await createStubLlmClient().writeSiteSummary({
      siteTitle: 'Acme',
      host: 'acme.example',
      homepageDescription: 'Acme makes things.',
      homepageContentMarkdown: '',
      listedPages: [],
      factPages: [],
      previousSummary: null,
      previousSiteName: null,
      previousNotes: [],
    });
    expect(summary).toEqual({ summary: 'Acme makes things.', notes: [], siteName: null });
  });
});
