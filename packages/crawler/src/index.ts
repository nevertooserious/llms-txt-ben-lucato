// The crawler owns all network I/O to target sites: robots.txt, sitemaps, page fetches
// and headless renders. Every outbound request goes through the SSRF guard.
export { crawlSite, type CrawlSiteOptions } from './crawl-site';
export { assertPublicAddress, isBlockedAddress } from './ssrf-guard';
