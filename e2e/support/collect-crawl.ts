import type { RawPage } from '@llms-txt/contracts';
import { crawlSite, type CrawlResult, type CrawlSiteOptions } from '@llms-txt/crawler';

/** A crawl with the pages it streamed to onPage, kept so tests can inspect them. */
export interface CollectedCrawl extends CrawlResult {
  pages: RawPage[];
}

export async function collectCrawl(options: Omit<CrawlSiteOptions, 'onPage'>): Promise<CollectedCrawl> {
  const pages: RawPage[] = [];
  const result = await crawlSite({ ...options, onPage: (page) => void pages.push(page) });
  return { ...result, pages };
}
