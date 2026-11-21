// What the generator is given: every page of the site, and one workspace's edits.

import type { CrawlSignals } from './crawl';
import type { StoredPageAssessment } from './page-assessment';
import type { PageRecord } from './page-record';

/** One page as the generator sees it: the record plus crawl signals. */
export interface GeneratorPage {
  record: PageRecord;
  /** Null until the page is assessed, and always null when no LLM is configured. */
  assessment: StoredPageAssessment | null;
  /** The URL as the site links it (pages.fetch_url); what the page's entry links when there is no .md variant. */
  fetchUrl: string;
  crawlSignals: CrawlSignals;
  markdownVariantUrl: string | null;
}

/** A workspace's edit to one page. Applied as an input on every render. */
export interface WorkspacePageOverride {
  normalisedUrl: string;
  descriptionOverride: string | null;
  isExcluded: boolean;
}
