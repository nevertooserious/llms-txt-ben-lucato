import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractLinks, extractPage, measureContentDensity, type ExtractPageInput } from './index';

// One saved HTML file per kind of page, in packages/extractor/fixtures/. Each test
// runs the whole extractor on it: HTML in, PageRecord out.
function readFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}.html`, import.meta.url), 'utf8');
}

function extract(html: string, url = 'https://lumen.example/docs/page', overrides: Partial<ExtractPageInput> = {}) {
  return extractPage({ html, normalisedUrl: url, finalUrl: url, isHomepage: false, ...overrides });
}

const page = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const longParagraph =
  'Lumen builds static sites from markdown and templates, and keeps rebuilds fast as a site grows past thousands of pages.';

describe('extractPage', () => {
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

    it('skips short paragraphs such as bylines when using the first paragraph', () => {
      const record = extract(readFixture('blog-post'), 'https://lumen.example/blog/faster-builds');
      expect(record.description).toMatch(/^Large sites were taking minutes to build/);
    });

    it('cuts a long first paragraph at a word boundary', () => {
      const description = extract(page('', `<main><p>${longParagraph.repeat(4)}</p></main>`)).description;
      expect(description).not.toBeNull();
      expect(description!.length).toBeLessThanOrEqual(300);
      expect(description).toMatch(/\w…$/);
    });
  });

  describe('main content', () => {
    it('extracts main content from a static page', () => {
      const record = extract(readFixture('static-docs-page'), 'https://lumen.example/docs/configuration');

      expect(record.title).toBe('Configuration');
      expect(record.description).toBe('Every option in lumen.config.json, with defaults and examples.');
      expect(record.canonicalUrl).toBe('https://lumen.example/docs/configuration');
      expect(record.languageCode).toBe('en-gb');
      expect(record.pageType).toBe('docs');

      const markdown = record.contentMarkdown;
      expect(markdown).toMatch(/^# Configuration\n/);
      expect(markdown).toContain('## Output directory');
      expect(markdown).toContain('```json\n{\n  "outputDirectory": "public",');
      expect(markdown).toContain('| outputDirectory | dist | Where built pages go |');
      // Relative links are made absolute; mailto links keep their text only.
      expect(markdown).toContain('[the build command](https://lumen.example/docs/cli#build)');
      expect(markdown).toContain('Email the team');
      expect(markdown).not.toContain('mailto:');
      // Page chrome, breadcrumbs, the table of contents and code are left out.
      for (const chrome of ['GitHub', 'Command line', 'On this page', 'Docs /', '© 2026', 'analyticsQueue', 'font-family']) {
        expect(markdown).not.toContain(chrome);
      }
    });

    it('resolves links against the final URL after redirects, not the normalised URL', () => {
      // /docs redirected to /docs/, so "configuration" means /docs/configuration.
      const record = extract(
        page('', '<main><p>See <a href="configuration">configuration</a>.</p></main>'),
        'https://lumen.example/docs',
        { finalUrl: 'https://lumen.example/docs/' },
      );
      expect(record.contentMarkdown).toContain('(https://lumen.example/docs/configuration)');
    });

    it('extracts main content from a headless-rendered client-side app', () => {
      const record = extract(readFixture('client-app-rendered'), 'https://pebble.example/help/shared-calendars');

      expect(record.title).toBe('Shared calendars · Pebble Help');
      expect(record.description).toMatch(/^A shared calendar lets everyone in a group/);
      expect(record.pageType).toBe('docs');

      const markdown = record.contentMarkdown;
      expect(markdown).toMatch(/^# Shared calendars\n/);
      expect(markdown).toContain('## Create a shared calendar');
      expect(markdown).toContain('- Editors can add, move and remove events.');
      expect(markdown).toContain('## Stop sharing');
      // The div-based top bar, sidebar, footer and cookie banner are not content.
      for (const chrome of ['Log in', 'Notifications', 'Pebble Software Ltd', 'We use cookies', 'enable JavaScript']) {
        expect(markdown).not.toContain(chrome);
      }
    });

    it('leaves hydration data out of a server-rendered page', () => {
      const record = extract(readFixture('server-rendered-hydrated'), 'https://tallyhq.example/pricing');

      expect(record.pageType).toBe('pricing');
      expect(record.contentMarkdown).toMatch(/^# Plans and pricing\n/);
      expect(record.contentMarkdown).toContain('## Team');
      expect(record.contentMarkdown).toContain('Upgrades apply straight away');
      expect(record.contentMarkdown).not.toContain('priceCents');
      expect(record.contentMarkdown).not.toContain('Privacy');
    });

    it('falls back to <body> without nav, header, footer and aside when there is no <main>', () => {
      const record = extract(readFixture('marketing-page-without-main'), 'https://harbour.example/', {
        isHomepage: true,
      });

      expect(record.pageType).toBe('home');
      const markdown = record.contentMarkdown;
      // Every section is kept, not just the densest one.
      expect(markdown).toMatch(/^# Inventory for small warehouses\n/);
      expect(markdown).toContain('### Reorder on time');
      expect(markdown).toContain('> We stopped running out of our best sellers');
      for (const chrome of ['Features', 'Spring offer', 'Quay Street', 'Terms']) {
        expect(markdown).not.toContain(chrome);
      }
    });

    it('takes the content from a post when the page also lists related articles', () => {
      const record = extract(readFixture('blog-post'), 'https://lumen.example/blog/faster-builds');

      expect(record.title).toBe('How we cut build times in half — Lumen Blog');
      expect(record.contentMarkdown).toMatch(/^# How we cut build times in half\n/);
      expect(record.contentMarkdown).toContain('By Dana Whitfield');
      expect(record.contentMarkdown).toContain('## What we changed');
      expect(record.contentMarkdown).not.toContain('Related posts');
    });

    it('writes ordered and nested lists as compact markdown', () => {
      const html = page(
        '',
        '<main><ol start="3"><li>Install</li><li>Configure<ul><li>Output</li><li>Minify</li></ul></li></ol></main>',
      );
      expect(extract(html).contentMarkdown).toBe('3. Install\n4. Configure\n   - Output\n   - Minify');
    });

    it('survives malformed HTML', () => {
      const record = extract(readFixture('malformed'), 'https://bakery.example/visit');

      expect(record.title).toBe('Opening hours & directions');
      expect(record.description).toBe('When we are open and how to find us');
      expect(record.contentMarkdown).toContain('The entrance is on Mill Lane, next to the bakery.');
      expect(record.contentMarkdown).toContain('Call ahead for groups larger than ten.');
    });

    it('returns an empty record for an empty document', () => {
      const record = extract('');
      expect(record).toMatchObject({ title: null, description: null, canonicalUrl: null, contentMarkdown: '' });
      expect(record.contentDigest).toMatch(/^[0-9a-f]{64}$/);
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
    const blogPost = readFixture('blog-post');
    const url = 'https://lumen.example/blog/faster-builds';

    it('gives the same content_digest when only dates and numbers change', () => {
      const original = extract(blogPost, url);
      const redated = extract(
        blogPost
          .replace('3 March 2026', '17 April 2026')
          .replace('2 days ago', '5 hours ago')
          .replace('1,204 views', '9,876 views')
          .replace('4,000 pages parsed its layout 4,000 times', '12,500 pages parsed its layout 12,500 times'),
        url,
      );
      expect(redated.contentDigest).toBe(original.contentDigest);
      expect(redated.listingFieldsHash).toBe(original.listingFieldsHash);
    });

    it('gives a different content_digest when the text changes', () => {
      const original = extract(blogPost, url);
      const edited = extract(blogPost.replace('shared by every page', 'reused by every page'), url);
      expect(edited.contentDigest).not.toBe(original.contentDigest);
    });

    it('leaves content out of listing_fields_hash when the page has a description', () => {
      const head = '<title>Install</title><meta name="description" content="How to install Lumen.">';
      const before = extract(page(head, '<main><p>Run the installer.</p></main>'));
      const after = extract(page(head, '<main><p>Download the binary.</p></main>'));
      expect(after.contentDigest).not.toBe(before.contentDigest);
      expect(after.listingFieldsHash).toBe(before.listingFieldsHash);
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
    expect(density.linkCount).toBeGreaterThanOrEqual(6);
  });

  it('reports high density for a client-side app once rendered', () => {
    const density = measureContentDensity(readFixture('client-app-rendered'));
    expect(density.textLength).toBeGreaterThan(400);
    expect(density.linkCount).toBeGreaterThanOrEqual(10);
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
});
