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

export interface RobotsRules {
  status: RobotsTxtStatus;
  isAllowed(url: string): boolean;
  /** Seconds between requests the site asked for; null if it asked for none. */
  crawlDelaySeconds: number | null;
  /** Sitemap URLs listed in robots.txt, absolute. */
  sitemapUrls: string[];
}

export function parseRobotsTxt(robotsTxtUrl: string, robotsTxt: string): RobotsRules {
  const robots = robotsParser(
    robotsTxtUrl,
    withOtherRecordsBeforeRules(truncateToBytes(robotsTxt, ROBOTS_TXT_MAX_PARSED_BYTES)),
  );
  const crawlDelay = robots.getCrawlDelay(ROBOTS_USER_AGENT_TOKEN);
  return {
    status: 'parsed',
    // undefined means the URL is on another host. The crawler only asks about its own
    // host's URLs; refuse anything else rather than guess.
    isAllowed: (url) => robots.isAllowed(withSchemeOf(robotsTxtUrl, url), ROBOTS_USER_AGENT_TOKEN) ?? false,
    crawlDelaySeconds: crawlDelay === undefined || !Number.isFinite(crawlDelay) || crawlDelay < 0 ? null : crawlDelay,
    sitemapUrls: robots.getSitemaps().flatMap((sitemapUrl) => absoluteUrl(sitemapUrl, robotsTxtUrl)),
  };
}

/**
 * Moves each record that is not `User-agent`, `Allow` or `Disallow` (`Sitemap`,
 * `Crawl-delay`, anything unknown) from after its group's rules to before them.
 *
 * RFC 9309 (section 2.2.4) says such records must not interfere with parsing the groups:
 * a `User-agent` line after rules starts a new group, whatever lies between. The parser
 * instead lets one of these records hold the group open, so in
 *
 *   User-agent: *
 *   Disallow: /private/
 *   Sitemap: https://example.com/sitemap.xml
 *
 *   User-agent: BadBot
 *   Disallow: /
 *
 * it reads `Disallow: /` as a rule for `*` too and the whole site as closed. Ahead of the
 * rules the record means the same and the group ends where it should.
 */
function withOtherRecordsBeforeRules(robotsTxt: string): string {
  const output: string[] = [];
  /** Where a moved record goes: just after the current group's `User-agent` lines. Null before any group. */
  let afterUserAgentLines: number | null = null;
  let groupHasRules = false;
  for (const line of robotsTxt.split(/\r\n|\r|\n/)) {
    const record = /^\s*([^#:\s]+)\s*:/.exec(line)?.[1]?.toLowerCase();
    if (record === 'user-agent') {
      output.push(line);
      afterUserAgentLines = output.length;
      groupHasRules = false;
    } else if (record === 'allow' || record === 'disallow') {
      output.push(line);
      groupHasRules = true;
    } else if (record !== undefined && groupHasRules && afterUserAgentLines !== null) {
      output.splice(afterUserAgentLines, 0, line);
      afterUserAgentLines += 1;
    } else {
      output.push(line);
    }
  }
  return output.join('\n');
}

/** A Sitemap line's URL. The protocol asks for a full URL; a path is taken as on this host. */
function absoluteUrl(sitemapUrl: string, robotsTxtUrl: string): string[] {
  try {
    return [new URL(sitemapUrl, robotsTxtUrl).href];
  } catch {
    return [];
  }
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
