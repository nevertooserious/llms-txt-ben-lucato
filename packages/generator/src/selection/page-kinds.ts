import type { GeneratorPage, PageType } from '@llms-txt/contracts';

/** The job board or careers page itself is listed, under Optional; what is under it is not. */
export const JOB_BOARD_SEGMENT = /^(?:jobs|careers)$/;

export function homepageOf(pages: readonly GeneratorPage[]): GeneratorPage | undefined {
  return pages.find((page) => page.crawlSignals.crawlDepth === 0) ?? pages.find((page) => page.record.pageType === 'home');
}

/**
 * Documentation writes about logging in, accounts and tags, at URLs that say so
 * (`/docs/auth`, `/docs/api/tags`), so these URL rules leave it alone.
 */
export function isDocumentationPage(page: GeneratorPage): boolean {
  return isDocumentationType(page.record.pageType);
}

function isDocumentationType(pageType: PageType): boolean {
  return pageType === 'docs' || pageType === 'api' || pageType === 'guide';
}
