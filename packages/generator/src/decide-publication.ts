import { createHash } from 'node:crypto';

// Whether a rendered llms.txt becomes a new version of a workspace's file, and what
// changed relative to the published one. Pure; the worker writes the version.

export interface PageChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

export type PublicationDecision =
  | { kind: 'unchanged' }
  | {
      kind: 'publish';
      llmsTxtContent: string;
      llmsTxtContentHash: string;
      listedPageCount: number;
      pageChanges: PageChanges;
    };

/**
 * Why a site with nothing to list publishes nothing: a file that is only a name and a
 * summary tells a reader no more than the homepage does, and usually means the crawl
 * could not get past it.
 */
export const NOTHING_TO_LIST_REASON =
  'No page besides the homepage could be listed, so nothing was published. The site may be a single page, route on the URL fragment (/#/docs), or sit behind a login.';

/** A new version only when the text differs from the published version's. */
export function decidePublication(publishedContent: string | null, renderedContent: string): PublicationDecision {
  if (publishedContent === renderedContent) return { kind: 'unchanged' };
  const before = listedEntries(publishedContent ?? '');
  const after = listedEntries(renderedContent);
  return {
    kind: 'publish',
    llmsTxtContent: renderedContent,
    llmsTxtContentHash: createHash('sha256').update(renderedContent).digest('hex'),
    listedPageCount: after.size,
    pageChanges: {
      added: [...after.keys()].filter((url) => !before.has(url)),
      removed: [...before.keys()].filter((url) => !after.has(url)),
      changed: [...after].filter(([url, line]) => before.has(url) && before.get(url) !== line).map(([url]) => url),
    },
  };
}

/**
 * The file's link entries, `- [title](url)` with an optional `: description`, keyed by
 * URL. The renderer encodes parentheses in URLs, so the first `)` ends the URL.
 */
export function listedEntries(llmsTxt: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of llmsTxt.split('\n')) {
    const match = /^- \[(?:\\.|[^\]\\])*\]\(([^)\s]+)\)/.exec(line);
    if (match) entries.set(match[1]!, line);
  }
  return entries;
}
