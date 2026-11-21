import robotsParser from 'robots-parser';

// robots.txt rules for one host, following RFC 9309 (section 2.3.1):
//
//   2xx                        parse the body, whatever its media type
//   more than five redirects   unavailable: allow everything
//   4xx                        unavailable: allow everything
//   5xx, or unreachable        assume complete disallow
//
// Crawl-delay is not in RFC 9309, but is a widely used extension; it is honoured as given.

/** The product token matched against User-agent lines; it also leads the user agent string. */
export const ROBOTS_USER_AGENT_TOKEN = 'LlmsTxtGenerator';

/** RFC 9309 requires parsing at least 500 KiB; anything after it may be ignored. */
export const ROBOTS_TXT_MAX_PARSED_BYTES = 500 * 1024;

/**
 * What became of robots.txt. `unreachable` means a 5xx, timeout or network failure: the
 * site is then not crawled at all, and the run should fail with that reason.
 */
export type RobotsTxtStatus = 'parsed' | 'unavailable' | 'unreachable';

export interface RobotsRules {
  status: RobotsTxtStatus;
  isAllowed(url: string): boolean;
  /** Seconds between requests the site asked for; null if it asked for none. */
  crawlDelaySeconds: number | null;
  /** Sitemap URLs listed in robots.txt, absolute. */
  sitemapUrls: string[];
}

export function parseRobotsTxt(robotsTxtUrl: string, robotsTxt: string): RobotsRules {
  const robots = robotsParser(robotsTxtUrl, truncateToBytes(robotsTxt, ROBOTS_TXT_MAX_PARSED_BYTES));
  const crawlDelay = robots.getCrawlDelay(ROBOTS_USER_AGENT_TOKEN);
  return {
    status: 'parsed',
    // undefined means the URL is on another host. The crawler only asks about its own
    // host's URLs; refuse anything else rather than guess.
    isAllowed: (url) => robots.isAllowed(url, ROBOTS_USER_AGENT_TOKEN) ?? false,
    crawlDelaySeconds: crawlDelay === undefined || !Number.isFinite(crawlDelay) || crawlDelay < 0 ? null : crawlDelay,
    sitemapUrls: robots.getSitemaps(),
  };
}

/** No usable robots.txt (4xx, or too many redirects): everything is allowed. */
export const robotsTxtUnavailable: RobotsRules = {
  status: 'unavailable',
  isAllowed: () => true,
  crawlDelaySeconds: null,
  sitemapUrls: [],
};

/** robots.txt could not be reached (5xx, timeout, network failure): nothing is allowed. */
export const robotsTxtUnreachable: RobotsRules = {
  status: 'unreachable',
  isAllowed: () => false,
  crawlDelaySeconds: null,
  sitemapUrls: [],
};

function truncateToBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  return bytes.length <= maxBytes ? text : bytes.subarray(0, maxBytes).toString('utf8');
}
