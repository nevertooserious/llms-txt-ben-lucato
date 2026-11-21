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

  it('supports * and $ wildcards', () => {
    const rules = parseRobotsTxt(robotsTxtUrl, 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session=\n');
    expect(rules.isAllowed('https://example.com/report.pdf')).toBe(false);
    expect(rules.isAllowed('https://example.com/report.pdf.html')).toBe(true);
    expect(rules.isAllowed('https://example.com/a?session=1')).toBe(false);
  });

  it('reads sitemaps and the crawl delay as given', () => {
    const rules = parseRobotsTxt(
      robotsTxtUrl,
      'User-agent: *\nCrawl-delay: 60\n\nSitemap: https://example.com/sitemap-a.xml\nSitemap: https://example.com/sitemap-b.xml\n',
    );
    expect(rules.sitemapUrls).toEqual(['https://example.com/sitemap-a.xml', 'https://example.com/sitemap-b.xml']);
    expect(rules.crawlDelaySeconds).toBe(60);
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
