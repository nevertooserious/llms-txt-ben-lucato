import { parseHtml } from './parse-html';
import { removeNonContent, selectMainContent } from './select-main-content';

export interface ContentDensity {
  /** Visible text length of the main content, whitespace excluded. */
  textLength: number;
  /** Links anywhere in the page body. */
  linkCount: number;
}

/**
 * Used by the crawler to decide whether a plain-HTTP page is a JavaScript shell that
 * needs a headless render. Pure, so the crawler can call it without breaking the
 * extractor's no-I/O rule. The thresholds belong to the crawler.
 */
export function measureContentDensity(html: string): ContentDensity {
  const $ = parseHtml(html);
  removeNonContent($);
  const linkCount = $('body a[href]').length;
  const textLength = selectMainContent($).text().replace(/\s+/g, '').length;
  return { textLength, linkCount };
}
