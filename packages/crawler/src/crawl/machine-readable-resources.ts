import { machineReadableResourceKindOf } from '@llms-txt/contracts';
import { isInScope } from '../discovery/normalise-url';
import { CrawlDeadlineReached, type PoliteFetcher } from './polite-fetcher';
import { isErrorStatus } from './crawl-failures';
import { HTML_TYPES } from './media-types';
import type { RobotsGate } from './robots-gate';
import type { FetchOutcome } from '../network/http-fetcher';

/** Most machine-readable files (llms-full.txt and other versions of it, a section's llms.txt, an OpenAPI description) requested per crawl. */
const MAX_MACHINE_READABLE_RESOURCE_CHECKS = 20;
/** Enough to learn that such a file is there; its content is not read. */
const MACHINE_READABLE_RESOURCE_BYTES_READ = 64 * 1024;

/**
 * The site's own files for machines, which are not HTML pages but belong in the file:
 * llms-full.txt and other versions of it, a section's llms.txt, an OpenAPI description.
 * URLs that name one are collected as the crawl meets them, and requested at its end.
 */
export class MachineReadableResourceFinder {
  /** URLs that name a machine-readable file, known ones first. */
  private readonly candidateUrls = new Set<string>();

  constructor(
    private readonly rootUrl: string,
    private readonly politeFetcher: PoliteFetcher,
    private readonly robots: RobotsGate,
  ) {}

  /** Notes the link if it names a machine-readable file of this site. Returns whether it does. */
  addCandidate(href: string, baseUrl?: string): boolean {
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return false;
    }
    url.hash = '';
    if (machineReadableResourceKindOf(url.href) === null || !isInScope(url.href, this.rootUrl)) return false;
    if (url.href === `${this.rootUrl}/llms.txt` || url.href === new URL('/llms.txt', this.rootUrl).href) return false;
    this.candidateUrls.add(url.href);
    return true;
  }

  /**
   * The candidates that are there. Null when the site stopped answering part-way, so
   * that what an earlier crawl found is kept.
   *
   * `hasPagesUnder` says whether the directory a file is in has pages of the site under
   * it. An `llms.txt` is the index of a section (`/docs/llms.txt` of `/docs/...`). Sites
   * also publish one beside every page as that page's text (`/docs/intro/llms.txt`), which
   * indexes nothing and would fill the list with as many of them as the crawl happened to see.
   */
  async find(hasPagesUnder: (fileUrl: string) => boolean): Promise<string[] | null> {
    const found: string[] = [];
    const candidates = [...this.candidateUrls]
      .filter((url) => machineReadableResourceKindOf(url) !== 'llms_txt_index' || hasPagesUnder(url))
      .slice(0, MAX_MACHINE_READABLE_RESOURCE_CHECKS);
    for (const url of candidates) {
      if (!this.robots.isAllowed(url)) continue;
      let outcome: FetchOutcome;
      try {
        outcome = await this.politeFetcher.fetch({
          url,
          acceptedContentTypes: ['*/*'],
          maxResponseBytes: MACHINE_READABLE_RESOURCE_BYTES_READ,
          truncateAtMaxBytes: true,
          isRedirectAllowed: this.robots.isRedirectAllowed,
        });
      } catch (error) {
        if (error instanceof CrawlDeadlineReached) return null;
        throw error;
      }
      if (outcome.kind === 'failed') {
        if (outcome.reason === 'timeout' || outcome.reason === 'network_error') return null;
        continue;
      }
      if (isErrorStatus(outcome.httpStatusCode)) return null;
      const isFile = outcome.contentType !== null && !HTML_TYPES.includes(outcome.contentType);
      if (outcome.httpStatusCode === 200 && isFile && isInScope(outcome.finalUrl, this.rootUrl)) found.push(url);
    }
    return found;
  }
}
