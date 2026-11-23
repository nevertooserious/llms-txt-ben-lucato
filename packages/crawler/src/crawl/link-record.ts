import type { KnownPage, LinkSignals } from '@llms-txt/contracts';
import { computeLinkGraphSignals } from './link-graph';

/** What the crawl learns about how the site's pages link to each other. */
export class CrawlLinkRecord {
  /** The links of each page read in this crawl, in page order. */
  readonly outboundLinksRead = new Map<string, string[]>();
  /** Pages that only forward with a meta refresh, and where to. */
  readonly metaRefreshTargets = new Map<string, string>();
  /** Known pages that answered 304 or 404/410, which decide whether their stored links count. */
  readonly notModifiedUrls = new Set<string>();
  readonly notFoundUrls = new Set<string>();
  /** The first homepage navigation link to each URL: its text and where it comes among them. */
  readonly navigationLinks = new Map<string, { label: string | null; position: number }>();
  homepageWasRead = false;

  /**
   * Each page's importance signals (its inbound link count, its place in the navigation),
   * for the pages this crawl fetched and, once the homepage was read, every known page.
   */
  linkSignals(
    rootUrl: string,
    emittedUrls: readonly string[],
    knownPages: ReadonlyMap<string, KnownPage>,
  ): Record<string, LinkSignals> {
    const graphSignals = computeLinkGraphSignals(rootUrl, this.currentLinksByPage(knownPages), this.metaRefreshTargets);
    const urls = new Set(emittedUrls);
    if (this.homepageWasRead) for (const url of knownPages.keys()) urls.add(url);
    return Object.fromEntries(
      [...urls].map((url) => [
        url,
        {
          isInSiteNavigation: this.navigationLinks.has(url),
          inboundLinkCount: graphSignals.get(url)?.inboundLinkCount ?? 0,
          navigationLabel: this.navigationLinks.get(url)?.label ?? null,
          navigationPosition: this.navigationLinks.get(url)?.position ?? null,
          firstLinkPosition: graphSignals.get(url)?.firstLinkPosition ?? null,
        },
      ]),
    );
  }

  /**
   * Every page of the site and the links it holds: as read in this crawl, else as stored.
   * The inbound link counts and the breadth-first walk are computed from it.
   */
  private currentLinksByPage(knownPages: ReadonlyMap<string, KnownPage>): Map<string, readonly string[]> {
    const linksByPage = new Map<string, readonly string[]>();
    for (const knownPage of knownPages.values()) {
      if (knownPage.outboundLinkUrls === null || this.notFoundUrls.has(knownPage.normalisedUrl)) continue;
      if (knownPage.isRemoved && !this.notModifiedUrls.has(knownPage.normalisedUrl)) continue;
      linksByPage.set(knownPage.normalisedUrl, knownPage.outboundLinkUrls);
    }
    for (const [url, links] of this.outboundLinksRead) linksByPage.set(url, links);
    for (const url of this.metaRefreshTargets.keys()) linksByPage.delete(url);
    return linksByPage;
  }
}
