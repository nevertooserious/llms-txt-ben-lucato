import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PageRecord } from '@llms-txt/contracts';
import { extractLinks, extractPage, measureContentDensity, type ExtractPageInput } from './index';

// Each fixture in packages/extractor/fixtures/ is a saved page. Its expected result is
// written by hand in fixtures/expected/: <name>.json holds the input and every
// PageRecord field except the markdown and the hashes, and <name>.md holds the exact
// markdown. The hashes are checked by behaviour below, not by value.
const fixturesDirectory = new URL('../fixtures/', import.meta.url);
const expectedDirectory = new URL('expected/', fixturesDirectory);

const fixtureNames = readdirSync(fixturesDirectory)
  .filter((fileName) => fileName.endsWith('.html'))
  .map((fileName) => fileName.replace(/\.html$/, ''))
  .sort();

type ExpectedFields = Omit<PageRecord, 'contentMarkdown' | 'contentDigest' | 'listingFieldsHash'>;

interface ExpectedResult {
  input: Omit<ExtractPageInput, 'html'>;
  record: ExpectedFields;
}

function readFixture(name: string): string {
  return readFileSync(new URL(`${name}.html`, fixturesDirectory), 'utf8');
}

function readExpected(name: string): ExpectedResult & { contentMarkdown: string } {
  const expected = JSON.parse(readFileSync(new URL(`${name}.json`, expectedDirectory), 'utf8')) as ExpectedResult;
  const contentMarkdown = readFileSync(new URL(`${name}.md`, expectedDirectory), 'utf8').replace(/\n$/, '');
  return { ...expected, contentMarkdown };
}

function extractFixture(name: string, transformHtml: (html: string) => string = (html) => html): PageRecord {
  return extractPage({ html: transformHtml(readFixture(name)), ...readExpected(name).input });
}

function extract(html: string, url = 'https://lumen.example/docs/page', overrides: Partial<ExtractPageInput> = {}) {
  return extractPage({ html, normalisedUrl: url, finalUrl: url, isHomepage: false, ...overrides });
}

const page = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const longParagraph =
  'Lumen builds static sites from markdown and templates, and keeps rebuilds fast as a site grows past thousands of pages.';

const sha256Hex = /^[0-9a-f]{64}$/;

describe('extractPage on saved pages', () => {
  it('has a hand-written expected result for every fixture', () => {
    const expectedNames = readdirSync(expectedDirectory)
      .filter((fileName) => /\.(?:json|md)$/.test(fileName))
      .map((fileName) => fileName.replace(/\.(?:json|md)$/, ''));
    for (const name of fixtureNames) {
      expect(expectedNames.filter((expectedName) => expectedName === name), name).toHaveLength(2);
    }
    expect(new Set(expectedNames)).toEqual(new Set(fixtureNames));
  });

  describe.each(fixtureNames)('%s', (name) => {
    const expected = readExpected(name);
    const { contentMarkdown, contentDigest, listingFieldsHash, ...fields } = extractFixture(name);

    it('extracts every field', () => {
      expect(fields).toEqual(expected.record);
    });

    it('converts the main content to the expected markdown', () => {
      expect(contentMarkdown).toBe(expected.contentMarkdown);
    });

    it('hashes the content and the listing fields', () => {
      expect(contentDigest).toMatch(sha256Hex);
      expect(listingFieldsHash).toMatch(sha256Hex);
      expect(listingFieldsHash).not.toBe(contentDigest);
    });
  });
});

describe('extractPage rules', () => {
  describe('title', () => {
    it('takes the title from og:title, then <title>, then the first <h1>', () => {
      const openGraph = '<meta property="og:title" content="From Open Graph">';
      const titleTag = '<title>From the title tag</title>';
      const heading = '<h1>From the heading</h1>';

      expect(extract(page(openGraph + titleTag, heading)).title).toBe('From Open Graph');
      expect(extract(page(titleTag, heading)).title).toBe('From the title tag');
      expect(extract(page('', heading)).title).toBe('From the heading');
      expect(extract(page('', '<p>No title anywhere.</p>')).title).toBeNull();
    });

    it('uses the <h1>, then <title>, when an inner page has the site name as its og:title', () => {
      const openGraph = '<meta property="og:title" content="Acme">';
      const inner = { normalisedUrl: 'https://acme.test/changes', finalUrl: 'https://acme.test/changes', isHomepage: false };

      const withHeading = page(`${openGraph}<title>changes – Acme</title>`, '<h1>What changed</h1>');
      expect(extractPage({ ...inner, html: withHeading }).title).toBe('What changed');
      const withoutHeading = page(`${openGraph}<title>Changes | Acme</title>`);
      expect(extractPage({ ...inner, html: withoutHeading }).title).toBe('Changes | Acme');
    });

    it('keeps an og:title that is the page name its <title> starts with', () => {
      const html = page('<meta property="og:title" content="Our blogs"><title>Our blogs | Acme</title>', '<h1>The latest post</h1>');
      expect(extract(html, 'https://acme.test/blogs').title).toBe('Our blogs');
    });

    it('takes the page name from <title> when the page declares the site name beside it', () => {
      const siteName = '<meta property="og:site_name" content="Acme">';
      const repeatedHomepageTitle = '<meta property="og:title" content="Welcome to Acme">';
      const html = page(`${siteName}${repeatedHomepageTitle}<title>Downloads | Acme</title>`, '<h1>Get the latest build</h1>');
      expect(extract(html, 'https://acme.test/downloads').title).toBe('Downloads');
      const siteNameFirst = page(`${siteName}<title>Acme – Downloads</title>`);
      expect(extract(siteNameFirst, 'https://acme.test/downloads').title).toBe('Downloads');
      const homepageHtml = page(`${siteName}<title>Welcome | Acme</title>`);
      expect(extract(homepageHtml, 'https://acme.test', { isHomepage: true }).title).toBe('Welcome | Acme');
    });

    it('drops the permalink anchor from a heading used as the title', () => {
      const html = page('', '<h1>Frequently asked questions<a class="headerlink" href="#faq">¶</a></h1>');
      expect(extract(html).title).toBe('Frequently asked questions');
    });
  });

  describe('declared site name', () => {
    it('takes og:site_name, then a JSON-LD WebSite name, then application-name', () => {
      const openGraph = '<meta property="og:site_name" content="From Open Graph">';
      const jsonLd = '<script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"From JSON-LD"}]}</script>';
      const applicationName = '<meta name="application-name" content="From application-name">';
      expect(extract(page(`${applicationName}${jsonLd}${openGraph}`)).declaredSiteName).toBe('From Open Graph');
      expect(extract(page(`${applicationName}${jsonLd}`)).declaredSiteName).toBe('From JSON-LD');
      expect(extract(page(applicationName)).declaredSiteName).toBe('From application-name');
      expect(extract(page('<title>No name</title>')).declaredSiteName).toBeNull();
    });

    it('ignores a declared name too long to be a name', () => {
      const html = page(`<meta property="og:site_name" content="${'A very long tagline. '.repeat(5)}">`);
      expect(extract(html).declaredSiteName).toBeNull();
    });

    it('keeps the site name as the homepage title', () => {
      const html = page('<meta property="og:title" content="Acme"><title>Welcome – Acme</title>', '<h1>Build faster</h1>');
      const title = extractPage({ html, normalisedUrl: 'https://acme.test', finalUrl: 'https://acme.test/', isHomepage: true }).title;
      expect(title).toBe('Acme');
    });

    it('skips empty candidates and collapses whitespace', () => {
      const html = page('<meta property="og:title" content="  "><title>\n  Spread\n  over lines </title>');
      expect(extract(html).title).toBe('Spread over lines');
    });
  });

  describe('description', () => {
    it('takes the description from meta description, then og:description, then the first paragraph', () => {
      const meta = '<meta name="description" content="From the meta tag">';
      const openGraph = '<meta property="og:description" content="From Open Graph">';
      const body = `<main><p>${longParagraph}</p></main>`;

      expect(extract(page(meta + openGraph, body)).description).toBe('From the meta tag');
      expect(extract(page(openGraph, body)).description).toBe('From Open Graph');
      expect(extract(page('', body)).description).toBe(longParagraph);
      expect(extract(page('', '<main><h1>Only a heading</h1></main>')).description).toBeNull();
    });

    it('skips paragraphs shorter than 50 characters, such as bylines', () => {
      const body = `<main><p>By Dana Whitfield · 3 March 2026</p><p>${longParagraph}</p></main>`;
      expect(extract(page('', body)).description).toBe(longParagraph);
    });

    it('cuts a long first paragraph at a word boundary', () => {
      const description = extract(page('', `<main><p>${longParagraph.repeat(4)}</p></main>`)).description;
      expect(description).not.toBeNull();
      expect(description!.length).toBeLessThanOrEqual(300);
      expect(description).toMatch(/\w…$/);
    });
  });

  describe('content', () => {
    it('resolves links against the final URL after redirects, not the normalised URL', () => {
      // /docs redirected to /docs/, so "configuration" means /docs/configuration.
      const record = extract(
        page('', '<main><p>See <a href="configuration">configuration</a>.</p></main>'),
        'https://lumen.example/docs',
        { finalUrl: 'https://lumen.example/docs/' },
      );
      expect(record.contentMarkdown).toBe('See [configuration](https://lumen.example/docs/configuration).');
    });

    it('writes ordered and nested lists as compact markdown', () => {
      const html = page(
        '',
        '<main><ol start="3"><li>Install</li><li>Configure<ul><li>Output</li><li>Minify</li></ul></li></ol></main>',
      );
      expect(extract(html).contentMarkdown).toBe('3. Install\n4. Configure\n   - Output\n   - Minify');
    });

    it('escapes pipes inside table cells', () => {
      const html = page('', '<main><table><tr><th>Flag</th></tr><tr><td><code>a|b</code></td></tr></table></main>');
      expect(extract(html).contentMarkdown).toBe('| Flag |\n| --- |\n| `a\\|b` |');
    });

    it('prefers a non-empty <main> over an empty one', () => {
      const html = page('', '<main id="app"></main><main><p>Second main.</p></main>');
      expect(extract(html).contentMarkdown).toBe('Second main.');
    });

    it('returns an empty record for an empty document', () => {
      const record = extract('', 'https://lumen.example/showcase');
      expect(record).toMatchObject({
        canonicalUrl: null,
        title: null,
        description: null,
        pageType: 'other',
        languageCode: null,
        contentMarkdown: '',
      });
      expect(record.contentDigest).toMatch(sha256Hex);
    });
  });

  describe('page type', () => {
    it.each([
      ['https://lumen.example/docs/configuration', 'docs'],
      ['https://lumen.example/en/docs/configuration', 'docs'],
      ['https://docs.lumen.example/configuration', 'docs'],
      ['https://lumen.example/docs/api/build', 'api'],
      ['https://lumen.example/api-reference/pages', 'api'],
      ['https://lumen.example/docs/guides/deploying', 'guide'],
      ['https://lumen.example/tutorials/first-site', 'guide'],
      ['https://lumen.example/blog/faster-builds', 'blog'],
      ['https://lumen.example/blog/our-api-guide', 'blog'],
      ['https://lumen.example/pricing', 'pricing'],
      ['https://lumen.example/about-us', 'about'],
      ['https://lumen.example/legal/privacy', 'legal'],
      ['https://lumen.example/about/legal', 'legal'],
      ['https://lumen.example/docs/cookies', 'docs'],
      ['https://lumen.example/blog/our-privacy-policy', 'blog'],
      ['https://lumen.example/help/billing', 'docs'],
      ['https://lumen.example/en/faq', 'docs'],
      ['https://lumen.example/foundation/faq', 'other'],
      ['https://lumen.example/about/help', 'about'],
      ['https://lumen.example/privacy-policy.html', 'legal'],
      ['https://lumen.example/features/themes', 'product'],
      ['https://lumen.example/showcase', 'other'],
    ] as const)('classifies %s as %s', (url, expectedPageType) => {
      expect(extract(page('<title>Page</title>'), url).pageType).toBe(expectedPageType);
    });

    it('classifies the homepage as home whatever its URL', () => {
      expect(extract(page(''), 'https://lumen.example/docs', { isHomepage: true }).pageType).toBe('home');
    });

    it('falls back to og:type and JSON-LD when the URL says nothing', () => {
      const article = page('<meta property="og:type" content="article">');
      const product = page('<script type="application/ld+json">{"@graph": [{"@type": "Product"}]}</script>');
      const brokenJson = page('<script type="application/ld+json">{"@type": </script>');

      expect(extract(article, 'https://lumen.example/2026/03/faster-builds').pageType).toBe('blog');
      expect(extract(product, 'https://lumen.example/lumen-pro').pageType).toBe('product');
      expect(extract(brokenJson, 'https://lumen.example/lumen-pro').pageType).toBe('other');
    });
  });

  describe('hashes', () => {
    it('gives the same content_digest when only dates and numbers change', () => {
      const original = extractFixture('blog-post');
      const redated = extractFixture('blog-post', (html) =>
        html
          .replace('3 March 2026', '17 April 2026')
          .replace('2 days ago', '5 hours ago')
          .replace('1,204 views', '9,876 views')
          .replace('4,000 pages parsed its layout 4,000 times', '12,500 pages parsed its layout 12,500 times'),
      );
      expect(redated.contentDigest).toBe(original.contentDigest);
      expect(redated.listingFieldsHash).toBe(original.listingFieldsHash);
    });

    it('gives the same hashes when only page chrome changes', () => {
      const original = extractFixture('static-docs-page');
      const rechromed = extractFixture('static-docs-page', (html) =>
        html
          .replace('Lumen Labs. Released under the MIT licence.', 'Lumen Labs Ltd. All rights reserved.')
          .replace('>Command line<', '>CLI reference<')
          .replace('>On this page<', '>Contents<'),
      );
      expect(rechromed.contentDigest).toBe(original.contentDigest);
      expect(rechromed.listingFieldsHash).toBe(original.listingFieldsHash);
    });

    it('gives a different content_digest when the text changes', () => {
      const original = extractFixture('blog-post');
      const edited = extractFixture('blog-post', (html) => html.replace('shared by every page', 'reused by every page'));
      expect(edited.contentDigest).not.toBe(original.contentDigest);
    });

    it('changes listing_fields_hash when the title or description changes', () => {
      const original = extractFixture('static-docs-page');
      const retitled = extractFixture('static-docs-page', (html) =>
        html.replace('content="Configuration"', 'content="Settings"'),
      );
      const redescribed = extractFixture('static-docs-page', (html) =>
        html.replace('with defaults and examples.', 'with their defaults.'),
      );
      expect(retitled.listingFieldsHash).not.toBe(original.listingFieldsHash);
      expect(redescribed.listingFieldsHash).not.toBe(original.listingFieldsHash);
    });

    it('includes content in listing_fields_hash when the page has a description', () => {
      const head = '<title>Install</title><meta name="description" content="How to install Lumen.">';
      const before = extract(page(head, '<main><p>Run the installer.</p></main>'));
      const after = extract(page(head, '<main><p>Download the binary.</p></main>'));
      expect(after.contentDigest).not.toBe(before.contentDigest);
      expect(after.listingFieldsHash).not.toBe(before.listingFieldsHash);
    });

    it('includes content in listing_fields_hash when the page has no description', () => {
      const before = extract(page('<title>Install</title>', '<main><h2>Run the installer</h2></main>'));
      const after = extract(page('<title>Install</title>', '<main><h2>Download the binary</h2></main>'));
      expect(after.description).toBeNull();
      expect(after.listingFieldsHash).not.toBe(before.listingFieldsHash);
    });
  });
});

describe('measureContentDensity', () => {
  it('reports low density for an empty client-side app shell', () => {
    expect(measureContentDensity(readFixture('client-app-shell'))).toEqual({ textLength: 0, linkCount: 0 });
  });

  it('reports high density for a server-rendered page', () => {
    const density = measureContentDensity(readFixture('server-rendered-hydrated'));
    expect(density.textLength).toBeGreaterThan(400);
    // Every link in the body counts, chrome included: header (4) and footer (2).
    expect(density.linkCount).toBe(6);
  });

  it('reports high density for a client-side app once rendered', () => {
    const density = measureContentDensity(readFixture('client-app-rendered'));
    expect(density.textLength).toBeGreaterThan(400);
    // Top bar (4), sidebar (4) and bottom bar (2).
    expect(density.linkCount).toBe(10);
  });
});

describe('extractLinks', () => {
  it('resolves relative links against the base URL', () => {
    const html = page(
      '',
      `<a href="/pricing">Pricing</a>
       <a href="cli#build">Build</a>
       <a href="../blog/">Blog</a>
       <a href="https://github.com/lumen-example/lumen">GitHub</a>`,
    );
    expect(extractLinks(html, 'https://lumen.example/docs/configuration')).toEqual([
      'https://lumen.example/pricing',
      'https://lumen.example/docs/cli',
      'https://lumen.example/blog/',
      'https://github.com/lumen-example/lumen',
    ]);
  });

  it('honours <base href>, skips non-http schemes and removes duplicates', () => {
    const html = page(
      '<base href="https://lumen.example/v2/">',
      `<a href="intro">Intro</a>
       <a href="intro#setup">Intro again</a>
       <a href="mailto:help@lumen.example">Email</a>
       <a href="javascript:void(0)">Menu</a>
       <a href="tel:+441234567890">Call</a>
       <a>No href</a>`,
    );
    expect(extractLinks(html, 'https://lumen.example/docs/')).toEqual(['https://lumen.example/v2/intro']);
  });

  it('returns every link on a saved page, in document order', () => {
    expect(extractLinks(readFixture('static-docs-page'), 'https://lumen.example/docs/configuration')).toEqual([
      'https://lumen.example/',
      'https://lumen.example/docs',
      'https://lumen.example/blog',
      'https://lumen.example/pricing',
      'https://github.com/lumen-example/lumen',
      'https://lumen.example/docs/installation',
      'https://lumen.example/docs/configuration',
      'https://lumen.example/docs/cli',
      'https://lumen.example/legal/privacy',
    ]);
  });
});
