import {
  parseRobotsTxt,
  ROBOTS_TXT_MAX_PARSED_BYTES,
  robotsTxtUnavailable,
  robotsTxtUnreachable,
  type RobotsRules,
} from '../discovery/robots-rules';
import type { CrawlFailureLog } from './crawl-failures';
import type { PoliteFetcher } from './polite-fetcher';

/** The robots.txt rules of the site's host, and of its other hosts as they are needed. */
export class RobotsGate {
  private rules: RobotsRules = robotsTxtUnavailable;
  /** robots.txt rules of the site's other hosts, by origin, loaded when first needed. */
  private readonly relatedHostRules = new Map<string, RobotsRules>();

  constructor(
    private readonly rootUrl: string,
    private readonly politeFetcher: PoliteFetcher,
    private readonly failures: CrawlFailureLog,
  ) {}

  get status(): RobotsRules['status'] {
    return this.rules.status;
  }

  get sitemapUrls(): readonly string[] {
    return this.rules.sitemapUrls;
  }

  /** RFC 9309, section 2.3.1. See robots-rules.ts for the table. */
  async load(): Promise<void> {
    this.rules = await this.fetchRobotsTxt(this.rootUrl, { recordFailures: true });
    if (this.rules.crawlDelaySeconds !== null) this.politeFetcher.raiseRequestInterval(this.rules.crawlDelaySeconds * 1000);
  }

  /** robots.txt rules for a URL on this site's host. robots.txt itself is always allowed. */
  isAllowed(url: string): boolean {
    return this.rules.isAllowed(url);
  }

  /** For a redirect target or a browser request: this host's rules, or a related host's once loaded. */
  readonly isRedirectAllowed = (url: string): boolean => {
    const target = new URL(url);
    if (target.host === new URL(this.rootUrl).host) return this.isAllowed(url);
    return this.relatedHostRules.get(target.origin)?.isAllowed(url) ?? true;
  };

  /**
   * If crawling example.com, both docs.example.com and example.com count.
   * 
   * But if crawling docs.example.com, example.com does not count.
   * 
   * This is a design choice, influenced by results from real websites. An alternative choice
   * would instead be to restrict to a single domain.
   */
  async isAllowedOnRelatedHost(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    let rules = this.relatedHostRules.get(origin);
    if (rules === undefined) {
      rules = await this.fetchRobotsTxt(origin, { recordFailures: false });
      this.relatedHostRules.set(origin, rules);
    }
    return rules.isAllowed(url);
  }

  private async fetchRobotsTxt(hostUrl: string, { recordFailures }: { recordFailures: boolean }): Promise<RobotsRules> {
    const robotsTxtUrl = new URL('/robots.txt', hostUrl).href;
    const outcome = await this.politeFetcher.fetch({
      url: robotsTxtUrl,
      // Parsed whatever its media type; only the first 500 KiB need be read.
      acceptedContentTypes: ['*/*'],
      maxResponseBytes: ROBOTS_TXT_MAX_PARSED_BYTES,
      truncateAtMaxBytes: true,
    });

    if (outcome.kind === 'failed') {
      const isUnavailable = ['too_many_redirects', 'invalid_url', 'unsupported_scheme'].includes(outcome.reason);
      if (!isUnavailable && recordFailures) this.failures.record(robotsTxtUrl, 'robots_txt_unreachable', outcome.message);
      return isUnavailable ? robotsTxtUnavailable : robotsTxtUnreachable;
    }
    const status = outcome.httpStatusCode;
    // Keyed on the requested URL: rules reached through a redirect still govern this host (RFC 9309, 2.3.1.2).
    if (status >= 200 && status < 300) return parseRobotsTxt(robotsTxtUrl, outcome.body);
    if (status >= 500) {
      if (recordFailures) this.failures.record(robotsTxtUrl, 'robots_txt_unreachable', `HTTP ${status}`, status);
      return robotsTxtUnreachable;
    }
    return robotsTxtUnavailable;
  }
}
