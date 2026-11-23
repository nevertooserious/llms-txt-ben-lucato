import type { DiscoverySource } from '@llms-txt/contracts';
import { isTranslation, pageLocaleOf, type PageLocale } from './page-locale';

/**
 * Pages of one family (see pageFamilyKeyOf) fetched before the rest of it waits for every
 * other page. A site's stream of content is most of its URLs, and comes first in its
 * sitemap: without this a budget is spent on a blog's latest posts before its about
 * page, its guides or its archive are reached. A dozen is enough to learn what a family
 * is, and when nothing else is waiting the rest of it is fetched as before.
 */
const FAMILY_PAGES_FETCHED_BEFORE_OTHERS = 12;

// Seeds of the same depth are fetched in this order.
const SOURCE_PRIORITY: Record<DiscoverySource, number> = {
  navigation: 0,
  existing_llms_txt: 1,
  sitemap: 2,
  page_link: 3,
};

export interface FrontierEntry {
  /** The normalised URL: the page's identity. */
  url: string;
  /** What is requested: the URL as first linked, cleaned only as far as RFC 3986 allows. */
  fetchUrl: string;
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  sitemapLastModified: string | null;
  order: number;
  /** The family whose other pages this one waits behind once enough are fetched; null when it never waits. */
  familyKey: string | null;
  /** The area of the documentation whose turn this page takes; null when it is not documentation. */
  documentationAreaKey: string | null;
  /**
   * On another host of the same site (docs.example.com), which the homepage navigation
   * links. Fetched as one page under that host's robots.txt; its links are not followed.
   */
  isOnRelatedHost: boolean;  /** The language the URL names in its path, if any (see pageLocaleOf). Left out for a page on a related host. */
  locale?: PageLocale | null;
}

/** A page to add: an entry whose place in the order is given only when a sitemap fixed it. */
export type NewFrontierEntry = Omit<FrontierEntry, 'order'> & { order?: number };

/** Every page the crawl has found, and which of them are still to be fetched, in what order. */
export class CrawlFrontier {
  private readonly entries = new Map<string, FrontierEntry>();
  private readonly pending = new Set<string>();
  /** How many pages of each family have been taken from the frontier. */
  private readonly pagesTakenByFamily = new Map<string, number>();
  /** How many pages of each area of the documentation have been taken from the frontier. */
  private readonly pagesTakenByDocumentationArea = new Map<string, number>();
  private insertionOrder = 0;
  /** The languages URLs name at each place in the path, to tell a translation from a section (see isTranslation). */
  private readonly languagesBySlot = new Map<string, Set<string>>();
  /** The homepage's language: pages in another are translations. Null until it is known. */
  siteLanguage: string | null = null;

  /**
   * `rootUrl` is what a language in a URL's path is read against. A page for which
   * `isKnownPage` holds was stored by an earlier crawl and is checked again whatever its language.
   */
  constructor(
    private readonly rootUrl: string,
    private readonly isKnownPage: (url: string) => boolean = () => false,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(url: string): boolean {
    return this.entries.has(url);
  }

  get(url: string): FrontierEntry | undefined {
    return this.entries.get(url);
  }

  urls(): IterableIterator<string> {
    return this.entries.keys();
  }

  /** Sets aside `count` places in the order, and returns the first of them. */
  reserveOrder(count: number): number {
    const firstOrder = this.insertionOrder;
    this.insertionOrder += count;
    return firstOrder;
  }

  /** Adds a page, or notes what is new about one already found. Returns whether it was added. */
  add(entry: NewFrontierEntry): boolean {
    const existing = this.entries.get(entry.url);
    if (existing !== undefined) {
      existing.crawlDepth = Math.min(existing.crawlDepth, entry.crawlDepth);
      existing.sitemapLastModified ??= entry.sitemapLastModified;
      // A page the sitemap listed first is still a navigation page once the homepage links
      // it, and must not wait behind the rest of the sitemap.
      const isPending = this.pending.has(entry.url);
      if (isPending && SOURCE_PRIORITY[entry.discoveredVia] < SOURCE_PRIORITY[existing.discoveredVia]) {
        existing.discoveredVia = entry.discoveredVia;
      }
      return false;
    }
    const locale = entry.isOnRelatedHost ? null : pageLocaleOf(entry.url, this.rootUrl);
    if (locale !== null) {
      const languages = this.languagesBySlot.get(locale.slotKey) ?? new Set<string>();
      this.languagesBySlot.set(locale.slotKey, languages.add(locale.language));
    }
    this.entries.set(entry.url, { ...entry, locale, order: entry.order ?? this.insertionOrder++ });
    this.pending.add(entry.url);
    return true;
  }

  /** A page that was reached by a redirect from another is not fetched again. */
  markFetched(url: string): void {
    this.pending.delete(url);
  }

  /**
   * The next page in order: nearest the homepage first, then by how it was found. A page
   * whose family has had its share waits behind every page that has not.
   *
   * Documentation never waits, so nothing shares a budget out within it: a sitemap lists
   * it by path, and 200 pages went on the two areas of 1,400 pages of documentation that
   * come first in the alphabet. So when the next page is one of documentation, the turn
   * goes to the area that has had the fewest pages, among the pages as near the homepage.
   * Documentation gets the turns it would have had, and a site within its budget has the
   * same pages read.
   */
  takeNext(): FrontierEntry | undefined {
    let best: FrontierEntry | undefined;
    let bestIsHeldBack = false;
    for (const url of this.pending) {
      const entry = this.entries.get(url)!;
      if (this.isTranslation(entry)) continue;
      const isHeldBack = this.isHeldBack(entry);
      const isBetter =
        best === undefined || (isHeldBack !== bestIsHeldBack ? bestIsHeldBack : compareEntries(entry, best) < 0);
      if (isBetter) {
        best = entry;
        bestIsHeldBack = isHeldBack;
      }
    }
    if (best === undefined) return undefined;
    if (this.takesTurnsByDocumentationArea(best)) best = this.nextOfLeastFetchedDocumentationArea(best);
    this.pending.delete(best.url);
    if (best.documentationAreaKey !== null) {
      const taken = this.pagesTakenByDocumentationArea.get(best.documentationAreaKey) ?? 0;
      this.pagesTakenByDocumentationArea.set(best.documentationAreaKey, taken + 1);
    }
    if (best.familyKey !== null) {
      this.pagesTakenByFamily.set(best.familyKey, (this.pagesTakenByFamily.get(best.familyKey) ?? 0) + 1);
    }
    return best;
  }

  /** A translation of a page in the site's language is never fetched: the file lists a page once. */
  private isTranslation(entry: FrontierEntry): boolean {
    if (entry.locale == null || entry.crawlDepth === 0 || this.isKnownPage(entry.url)) return false;
    return isTranslation(entry.locale, this.siteLanguage, {
      languagesAtSlot: this.languagesBySlot.get(entry.locale.slotKey)!,
      hasPage: (url) => this.entries.has(url) || this.entries.has(url.replace(/\/$/, '')),
    });
  }

  /**
   * Whether enough of the page's family has been fetched for it to wait. A page the
   * navigation or the site's own llms.txt names was chosen by the site, and never waits.
   */
  private isHeldBack(entry: FrontierEntry): boolean {
    if (entry.familyKey === null) return false;
    if (entry.discoveredVia === 'navigation' || entry.discoveredVia === 'existing_llms_txt') return false;
    return (this.pagesTakenByFamily.get(entry.familyKey) ?? 0) >= FAMILY_PAGES_FETCHED_BEFORE_OTHERS;
  }

  /**
   * Whether the page is one of documentation that takes its area's turn. A page the
   * navigation or the site's own llms.txt names was chosen by the site, in the site's
   * order, and is fetched when that order says.
   */
  private takesTurnsByDocumentationArea(entry: FrontierEntry): boolean {
    if (entry.documentationAreaKey === null) return false;
    return entry.discoveredVia !== 'navigation' && entry.discoveredVia !== 'existing_llms_txt';
  }

  /**
   * The page to fetch in place of `next`: of the documentation pages as near the homepage,
   * the first of the area that has had the fewest pages. Areas that have had as many keep
   * the usual order, so the areas are visited in the site's order, and so are an area's pages.
   */
  private nextOfLeastFetchedDocumentationArea(next: FrontierEntry): FrontierEntry {
    const takenOf = (entry: FrontierEntry) => this.pagesTakenByDocumentationArea.get(entry.documentationAreaKey!) ?? 0;
    let best = next;
    for (const url of this.pending) {
      const entry = this.entries.get(url)!;
      if (entry.crawlDepth !== next.crawlDepth || !this.takesTurnsByDocumentationArea(entry)) continue;
      if (this.isTranslation(entry)) continue;
      if (this.isHeldBack(entry) !== this.isHeldBack(next)) continue;
      if ((takenOf(entry) - takenOf(best) || compareEntries(entry, best)) < 0) best = entry;
    }
    return best;
  }
}

function compareEntries(a: FrontierEntry, b: FrontierEntry): number {
  return (
    a.crawlDepth - b.crawlDepth ||
    SOURCE_PRIORITY[a.discoveredVia] - SOURCE_PRIORITY[b.discoveredVia] ||
    a.order - b.order
  );
}
