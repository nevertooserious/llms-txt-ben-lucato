import { NotImplementedError, type RawPage } from '@llms-txt/contracts';

export interface CrawlSiteOptions {
  rootUrl: string;
  pageBudget: number;
  /** Called as pages are discovered and fetched, to update pipeline_runs progress. */
  onProgress?: (progress: { pagesDiscovered: number; pagesFetched: number; pagesFailed: number }) => void;
}

/**
 * Discovery (robots.txt, sitemaps, existing llms.txt, homepage navigation), then a
 * prioritised breadth-first crawl. Plain HTTP first; headless render when the page's
 * content density is below the threshold.
 */
export async function crawlSite(options: CrawlSiteOptions): Promise<RawPage[]> {
  void options;
  throw new NotImplementedError('crawlSite');
}
