import robotsParser from 'robots-parser';
import type { RobotsTxtStatus } from '@llms-txt/contracts';

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

export type { RobotsTxtStatus };

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
    isAllowed: (url) => robots.isAllowed(withSchemeOf(robotsTxtUrl, url), ROBOTS_USER_AGENT_TOKEN) ?? false,
    crawlDelaySeconds: crawlDelay === undefined || !Number.isFinite(crawlDelay) || crawlDelay < 0 ? null : crawlDelay,
    sitemapUrls: robots.getSitemaps(),
  };
}

/**
 * The URL under the scheme robots.txt was fetched with, when it is on the same host and
 * both use their default port. A site that redirects `https://host/docs` to
 * `http://host/docs/` and back passes through the other scheme of the same host, and its
 * own rules are the ones we have for it; without this the hop would count as another
 * host's URL and be refused.
 */
function withSchemeOf(robotsTxtUrl: string, url: string): string {
  try {
    const target = new URL(url);
    const robots = new URL(robotsTxtUrl);
    if (target.hostname !== robots.hostname || target.port !== '' || robots.port !== '') return url;
    target.protocol = robots.protocol;
    return target.href;
  } catch {
    return url;
  }
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
