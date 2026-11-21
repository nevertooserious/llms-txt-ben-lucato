// The LLM's judgement of one page, which the generator selects and describes pages by.

import { PAGE_TYPES, type PageType } from './page-record';

/** How much a page belongs in the llms.txt, judged from its content. */
export const PAGE_LISTING_VALUES = ['primary', 'optional', 'exclude'] as const;
export type PageListingValue = (typeof PAGE_LISTING_VALUES)[number];

/** Why a page was judged not to belong in the file. */
export const PAGE_EXCLUSION_REASONS = [
  /** A "not found", error, maintenance or access-denied page, whatever its status code. */
  'error_page',
  /** Login, sign-up, cart, checkout, account, search results, thank-you pages. */
  'utility',
  /** A placeholder or a page with almost no content. */
  'thin',
  /** A tag, category, author or date listing. */
  'archive',
  /** One blog post, news item, press release, case study, changelog entry or episode. */
  'individual_content',
  /** One small item of a larger reference: a single configuration option, flag, error code or function. */
  'reference_entry',
  /** A copy of another page, such as a print version. */
  'duplicate',
] as const;
export type PageExclusionReason = (typeof PAGE_EXCLUSION_REASONS)[number];

/** The page types an assessment can choose. Only the crawl root is the homepage. */
export type AssessedPageType = Exclude<PageType, 'home'>;
export const ASSESSED_PAGE_TYPES = PAGE_TYPES.filter((pageType): pageType is AssessedPageType => pageType !== 'home');

/** The LLM's reading of one page. */
export interface PageAssessment {
  /** One line saying what a reader finds on the page. */
  description: string;
  listingValue: PageListingValue;
  /** Set exactly when listingValue is `exclude`. */
  exclusionReason: PageExclusionReason | null;
  /** Corrects the extractor's URL-based page type. */
  pageType: AssessedPageType;
}

/** An assessment as stored, with the hash of the inputs it was made from. */
export interface StoredPageAssessment extends PageAssessment {
  sourceHash: string;
}
