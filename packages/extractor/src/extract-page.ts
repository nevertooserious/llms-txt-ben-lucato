import { NotImplementedError, type PageRecord } from '@llms-txt/contracts';

export interface ExtractPageInput {
  /** Raw response body or headless-rendered DOM; the extractor does not care which. */
  html: string;
  normalisedUrl: string;
  isHomepage: boolean;
}

/**
 * Title: Open Graph title, then <title>, then the first <h1>.
 * Description: meta description, then Open Graph description, then the first paragraph.
 * Content: <main>, <article>, [role=main], a Readability-style scorer, then <body>
 * minus nav, header, footer and aside; converted to markdown.
 */
export function extractPage(input: ExtractPageInput): PageRecord {
  void input;
  throw new NotImplementedError('extractPage');
}
