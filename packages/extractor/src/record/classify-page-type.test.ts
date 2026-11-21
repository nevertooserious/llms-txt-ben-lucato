import { describe, expect, it } from 'vitest';
import { classifyPageType } from './classify-page-type';

const typeOf = (url: string) => classifyPageType({ url, isHomepage: false, openGraphType: null, structuredDataTypes: [] });

describe('classifyPageType, reading the host', () => {
  it.each([
    ['https://example.com/help', 'docs'],
    ['https://example.co.uk/help', 'docs'],
    ['https://www.example.co.uk/faq', 'docs'],
    ['https://example.com.au/support', 'docs'],
    ['https://acme.github.io/help', 'docs'],
    ['http://127.0.0.1:3000/help', 'docs'],
  ])('does not take the site name for a subdomain: %s', (url, expected) => {
    expect(typeOf(url)).toBe(expected);
  });

  it.each([
    ['https://docs.example.com/intro', 'docs'],
    ['https://docs.example.co.uk/intro', 'docs'],
    ['https://blog.acme.github.io/hello', 'blog'],
  ])('reads a real subdomain: %s', (url, expected) => {
    expect(typeOf(url)).toBe(expected);
  });

  it.each(['https://docs.co.uk/widgets', 'https://news.com.au/widgets', 'https://help.github.io/widgets'])(
    'does not read a section from the site name: %s',
    (url) => {
      expect(typeOf(url)).toBe('other');
    },
  );

  it('still treats help below another section as that section’s own page', () => {
    expect(typeOf('https://example.co.uk/foundation/faq')).toBe('other');
  });
});
