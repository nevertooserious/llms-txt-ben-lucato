// What the extractor hands on: one PageRecord per fetched page.

export const PAGE_TYPES = [
  'home',
  'docs',
  'api',
  'guide',
  'blog',
  'product',
  'pricing',
  'about',
  'legal',
  'other',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Extractor output. Mirrors the extractor's column group in `pages`. */
export interface PageRecord {
  normalisedUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  /**
   * The site's name as the page declares it: `og:site_name`, a JSON-LD `WebSite` name,
   * or `application-name`. The homepage's becomes the H1.
   */
  declaredSiteName: string | null;
  pageType: PageType;
  languageCode: string | null;
  contentMarkdown: string;
  /** SHA-256 of headings and body text with dates, numbers and whitespace stripped. */
  contentDigest: string;
  /** SHA-256 of what feeds this page's llms.txt entry; the monitor's change signal. */
  listingFieldsHash: string;
}
