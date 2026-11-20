import robotsParser from 'robots-parser';

// robots.txt rules for one host. A missing or unreadable robots.txt allows everything,
// as RFC 9309 says for a 4xx; a 5xx is treated the same, which RFC 9309 would call
// cautious-disallow, because refusing to crawl a site whose robots.txt errors makes the
// product useless on many small sites. The user can always exclude pages.

/** The product token matched against User-agent lines. */
export const ROBOTS_USER_AGENT_TOKEN = 'LlmsTxtGenerator';

/** Crawl-delay values above this are capped, so one site cannot stall a worker. */
const MAX_CRAWL_DELAY_SECONDS = 10;

export interface RobotsRules {
  isAllowed(url: string): boolean;
  /** Seconds between requests the site asked for, capped; null if it asked for none. */
  crawlDelaySeconds: number | null;
  /** Sitemap URLs listed in robots.txt, absolute. */
  sitemapUrls: string[];
}

export function parseRobotsTxt(robotsTxtUrl: string, robotsTxt: string): RobotsRules {
  const robots = robotsParser(robotsTxtUrl, robotsTxt);
  const crawlDelay = robots.getCrawlDelay(ROBOTS_USER_AGENT_TOKEN);
  return {
    // undefined means the URL is on another host; the crawler never asks about those.
    isAllowed: (url) => robots.isAllowed(url, ROBOTS_USER_AGENT_TOKEN) ?? false,
    crawlDelaySeconds:
      crawlDelay === undefined || !Number.isFinite(crawlDelay) || crawlDelay < 0
        ? null
        : Math.min(crawlDelay, MAX_CRAWL_DELAY_SECONDS),
    sitemapUrls: robots.getSitemaps(),
  };
}

export const allowEverything: RobotsRules = {
  isAllowed: () => true,
  crawlDelaySeconds: null,
  sitemapUrls: [],
};
