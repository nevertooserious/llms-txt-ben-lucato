import { describe, expect, it } from 'vitest';
import { parseRobotsTxt } from './robots-rules';

const robotsTxtUrl = 'https://example.com/robots.txt';

describe('parseRobotsTxt', () => {
  it('applies the * group, with the longest match winning', () => {
    const rules = parseRobotsTxt(robotsTxtUrl, 'User-agent: *\nDisallow: /private/\nAllow: /private/press/\n');
    expect(rules.isAllowed('https://example.com/docs')).toBe(true);
    expect(rules.isAllowed('https://example.com/private/notes')).toBe(false);
    expect(rules.isAllowed('https://example.com/private/press/kit')).toBe(true);
  });

  it('prefers a group naming this crawler over *', () => {
    const rules = parseRobotsTxt(
      robotsTxtUrl,
      'User-agent: *\nDisallow: /\n\nUser-agent: LlmsTxtGenerator\nDisallow: /admin\n',
    );
    expect(rules.isAllowed('https://example.com/docs')).toBe(true);
    expect(rules.isAllowed('https://example.com/admin')).toBe(false);
  });

  it('applies the rules to the same host under the other scheme, and refuses other hosts', () => {
    const rules = parseRobotsTxt(robotsTxtUrl, 'User-agent: *\nDisallow: /private/\n');
    // https://example.com/docs -> http://example.com/docs/ -> https://example.com/docs/
    expect(rules.isAllowed('http://example.com/docs/')).toBe(true);
    expect(rules.isAllowed('http://example.com/private/notes')).toBe(false);
    expect(rules.isAllowed('http://example.com:8080/docs/')).toBe(false);
    expect(rules.isAllowed('https://other.example/docs')).toBe(false);
  });

  it('supports * and $ wildcards', () => {
    const rules = parseRobotsTxt(robotsTxtUrl, 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session=\n');
    expect(rules.isAllowed('https://example.com/report.pdf')).toBe(false);
    expect(rules.isAllowed('https://example.com/report.pdf.html')).toBe(true);
    expect(rules.isAllowed('https://example.com/a?session=1')).toBe(false);
  });

  it.each([
    ['a Sitemap line', 'Sitemap: https://example.com/sitemap.xml'],
    ['a Crawl-delay line', 'Crawl-delay: 4'],
    ['a record it does not know', 'Content-Signal: search=yes'],
  ])('ends a group at the next User-agent line when %s follows its rules', (_name, record) => {
    // gnu.org's layout: the * group, then a line that is not a rule, then bots it shuts out.
    const rules = parseRobotsTxt(
      robotsTxtUrl,
      `User-agent: *\nDisallow: /private/\n${record}\n\n# SEO\nUser-agent: BadBot\nDisallow: /\n`,
    );
    expect(rules.isAllowed('https://example.com/')).toBe(true);
    expect(rules.isAllowed('https://example.com/docs')).toBe(true);
    expect(rules.isAllowed('https://example.com/private/notes')).toBe(false);
  });

  it('still reads a crawl delay and a sitemap that follow the rules of their group', () => {
    const rules = parseRobotsTxt(
      robotsTxtUrl,
      'User-agent: Other\nDisallow: /\nCrawl-delay: 9\n\nUser-agent: *\nDisallow: /private/\nCrawl-delay: 4\nSitemap: /sitemap.xml\n\nUser-agent: BadBot\nCrawl-delay: 60\nDisallow: /\n',
    );
    expect(rules.crawlDelaySeconds).toBe(4);
    expect(rules.sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
    expect(rules.isAllowed('https://example.com/docs')).toBe(true);
  });

  it('keeps consecutive User-agent lines as one group', () => {
    const rules = parseRobotsTxt(robotsTxtUrl, 'User-agent: BadBot\nUser-agent: *\nSitemap: /sitemap.xml\nDisallow: /private/\n');
    expect(rules.isAllowed('https://example.com/private/notes')).toBe(false);
    expect(rules.isAllowed('https://example.com/docs')).toBe(true);
  });

  it('reads sitemaps and the crawl delay as given', () => {
    const rules = parseRobotsTxt(
      robotsTxtUrl,
      'User-agent: *\nCrawl-delay: 60\n\nSitemap: https://example.com/sitemap-a.xml\nSitemap: https://example.com/sitemap-b.xml\n',
    );
    expect(rules.sitemapUrls).toEqual(['https://example.com/sitemap-a.xml', 'https://example.com/sitemap-b.xml']);
    expect(rules.crawlDelaySeconds).toBe(60);
  });

  it('takes a Sitemap line that gives only a path as on the host of robots.txt', () => {
    const rules = parseRobotsTxt(robotsTxtUrl, 'Sitemap: /sitemaps/pages.xml\nSitemap: http://[bad\n');
    expect(rules.sitemapUrls).toEqual(['https://example.com/sitemaps/pages.xml']);
  });

  it('parses only the first 500 KiB, as RFC 9309 allows', () => {
    const padding = `# ${'x'.repeat(500 * 1024)}\n`;
    const rules = parseRobotsTxt(robotsTxtUrl, `User-agent: *\nDisallow: /early\n${padding}Disallow: /late\n`);
    expect(rules.isAllowed('https://example.com/early')).toBe(false);
    expect(rules.isAllowed('https://example.com/late')).toBe(true);
  });

  it('marks parsed rules with their status', () => {
    expect(parseRobotsTxt(robotsTxtUrl, '').status).toBe('parsed');
  });

  it('allows everything for an empty file', () => {
    const rules = parseRobotsTxt(robotsTxtUrl, '');
    expect(rules.isAllowed('https://example.com/anything')).toBe(true);
    expect(rules.crawlDelaySeconds).toBeNull();
  });
});
