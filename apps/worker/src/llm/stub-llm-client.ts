import { ASSESSED_PAGE_TYPES } from '@llms-txt/contracts';
import type { LlmClient } from '@llms-txt/generator';

/**
 * Stands in for the model in local development and tests: no network, no cost, and the
 * same answer every time. It keeps every page and repeats what the crawl found, so its
 * output shows the pipeline working, not the quality of a real file.
 */
export function createStubLlmClient(): LlmClient {
  return {
    assessPage(input) {
      return Promise.resolve({
        description: input.metaDescription ?? '',
        listingValue: 'primary',
        exclusionReason: null,
        scope: 'broad',
        pageType: ASSESSED_PAGE_TYPES.find((pageType) => pageType === input.urlBasedPageType) ?? 'other',
      });
    },
    writeSiteSummary(input) {
      return Promise.resolve({ summary: input.homepageDescription ?? '', notes: [], siteName: null });
    },
  };
}
