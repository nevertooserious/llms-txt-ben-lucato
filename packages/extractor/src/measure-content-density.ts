import { NotImplementedError } from '@llms-txt/contracts';

export interface ContentDensity {
  /** Visible text length of the main content. */
  textLength: number;
  linkCount: number;
}

/**
 * Used by the crawler to decide whether a plain-HTTP page is a JavaScript shell that
 * needs a headless render. Pure, so the crawler can call it without breaking the
 * extractor's no-I/O rule.
 */
export function measureContentDensity(html: string): ContentDensity {
  void html;
  throw new NotImplementedError('measureContentDensity');
}
