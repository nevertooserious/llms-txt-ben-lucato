import type { LinkSignals } from '@llms-txt/contracts';

export type LinkGraphSignals = Pick<LinkSignals, 'inboundLinkCount' | 'firstLinkPosition'>;

/**
 * Inbound counts and link order, computed from every page's links as they stand. Pure, so
 * a check that re-read few pages gets the same answer as one that re-read them all.
 *
 * The walk is breadth-first from the homepage, reading each page's links in order and
 * numbering each URL the first time it appears. Pages the homepage does not lead to (found
 * through the sitemap) are walked after it, in URL order. `redirects` maps a page that only
 * forwards with a meta refresh to its target, so links to it count toward the target.
 */
export function computeLinkGraphSignals(
  rootUrl: string,
  linksByPage: ReadonlyMap<string, readonly string[]>,
  redirects: ReadonlyMap<string, string> = new Map(),
): Map<string, LinkGraphSignals> {
  const resolvedLinksByPage = new Map<string, string[]>();
  for (const [pageUrl, links] of linksByPage) {
    const resolved = new Set(links.map((link) => followRedirects(link, redirects)));
    resolved.delete(pageUrl);
    resolvedLinksByPage.set(pageUrl, [...resolved]);
  }

  const inboundLinkCounts = new Map<string, number>();
  for (const links of resolvedLinksByPage.values()) {
    for (const link of links) inboundLinkCounts.set(link, (inboundLinkCounts.get(link) ?? 0) + 1);
  }

  const firstLinkPositions = new Map<string, number>();
  const visitedPages = new Set<string>();
  const walkFrom = (startUrl: string): void => {
    if (visitedPages.has(startUrl) || !resolvedLinksByPage.has(startUrl)) return;
    visitedPages.add(startUrl);
    const queue = [startUrl];
    for (const pageUrl of queue) {
      for (const link of resolvedLinksByPage.get(pageUrl)!) {
        if (!firstLinkPositions.has(link)) firstLinkPositions.set(link, firstLinkPositions.size);
        if (resolvedLinksByPage.has(link) && !visitedPages.has(link)) {
          visitedPages.add(link);
          queue.push(link);
        }
      }
    }
  };
  walkFrom(rootUrl);
  for (const pageUrl of [...resolvedLinksByPage.keys()].sort()) walkFrom(pageUrl);

  const signals = new Map<string, LinkGraphSignals>();
  for (const url of new Set([...inboundLinkCounts.keys(), ...firstLinkPositions.keys()])) {
    signals.set(url, {
      inboundLinkCount: inboundLinkCounts.get(url) ?? 0,
      firstLinkPosition: firstLinkPositions.get(url) ?? null,
    });
  }
  return signals;
}

function followRedirects(url: string, redirects: ReadonlyMap<string, string>): string {
  const seen = new Set([url]);
  let current = url;
  for (;;) {
    const next = redirects.get(current);
    if (next === undefined || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
}
