import { describe, expect, it } from 'vitest';
import type { GeneratorPage, PageType } from '@llms-txt/contracts';
import { listedEntries } from './decide-publication';
import { generateLlmsTxt, type GenerateLlmsTxtInput } from './generate-llms-txt';
import { compareText, isPaginationUrl } from './select-pages';
import { validateLlmsTxt } from './validate-llms-txt';

const ORIGIN = 'https://example.com';

interface PageOptions {
  title?: string | null;
  description?: string | null;
  pageType?: PageType;
  crawlDepth?: number;
  isInSiteNavigation?: boolean;
  inboundLinkCount?: number;
  hasNoindexDirective?: boolean;
  canonicalUrl?: string | null;
  languageCode?: string | null;
  markdownVariantUrl?: string | null;
  fetchUrl?: string;
}

function page(path: string, options: PageOptions = {}): GeneratorPage {
  const normalisedUrl = path === '/' ? ORIGIN : `${ORIGIN}${path}`;
  return {
    record: {
      normalisedUrl,
      canonicalUrl: options.canonicalUrl ?? null,
      title: options.title === undefined ? `Title of ${path}` : options.title,
      description: options.description === undefined ? `About ${path}.` : options.description,
      pageType: options.pageType ?? (path === '/' ? 'home' : 'other'),
      languageCode: options.languageCode ?? null,
      contentMarkdown: '',
      contentDigest: 'digest',
      listingFieldsHash: 'hash',
    },
    fetchUrl: options.fetchUrl ?? normalisedUrl,
    crawlSignals: {
      crawlDepth: options.crawlDepth ?? (path === '/' ? 0 : 1),
      discoveredVia: 'navigation',
      hasNoindexDirective: options.hasNoindexDirective ?? false,
      isInSiteNavigation: options.isInSiteNavigation ?? false,
      inboundLinkCount: options.inboundLinkCount ?? 0,
    },
    markdownVariantUrl: options.markdownVariantUrl ?? null,
  };
}

const homepage = page('/', { title: 'Example', description: 'Example makes examples.' });

const generate = (input: Partial<GenerateLlmsTxtInput> & { pages: GeneratorPage[] }) =>
  generateLlmsTxt({ siteTitle: 'Example', siteSummary: null, overrides: [], ...input });

/** Section name -> the URLs listed under it, in order. */
function sections(llmsTxt: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of llmsTxt.split('\n')) {
    if (line.startsWith('## ')) result[(current = line.slice(3))] = [];
    else if (current !== null && line.startsWith('- ')) result[current]!.push(/\]\(([^)]+)\)/.exec(line)![1]!);
  }
  return result;
}

describe('generateLlmsTxt', () => {
  it('renders the H1, the summary and the sections, in the spec’s order', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/docs/intro', { pageType: 'docs', title: 'Intro', description: 'Start here.' })],
    });
    expect(llmsTxt).toBe(
      ['# Example', '', '> Example makes examples.', '', '## Docs', '', `- [Intro](${ORIGIN}/docs/intro): Start here.`, ''].join('\n'),
    );
  });

  it('renders the same text for the same input, whatever the input order', () => {
    const pages = [homepage, page('/a'), page('/b'), page('/c', { pageType: 'docs' }), page('/d', { inboundLinkCount: 3 })];
    const first = generate({ pages });
    expect(generate({ pages: [...pages].reverse() })).toBe(first);
  });

  it('prefers the cached summary to the homepage description', () => {
    expect(generate({ pages: [homepage], siteSummary: 'A cached\nsummary.' })).toContain('> A cached summary.\n');
  });

  it('is valid with only an H1 when there is nothing else to say', () => {
    const llmsTxt = generate({ pages: [page('/', { description: null })] });
    expect(llmsTxt).toBe('# Example\n');
    expect(validateLlmsTxt(llmsTxt).isValid).toBe(true);
  });

  it('derives H2 sections from page type, in a fixed order', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/blog/post', { pageType: 'blog' }),
        page('/pricing', { pageType: 'pricing' }),
        page('/docs/api/users', { pageType: 'api' }),
        page('/docs/intro', { pageType: 'docs' }),
        page('/guides/setup', { pageType: 'guide' }),
        page('/random', { pageType: 'other' }),
      ],
    });
    expect(Object.keys(sections(llmsTxt))).toEqual(['Docs', 'API', 'Guides', 'Pricing', 'Blog', 'Pages']);
  });

  it('orders entries by importance: navigation, then depth, then inbound links', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/docs/deep', { pageType: 'docs', crawlDepth: 3 }),
        page('/docs/linked', { pageType: 'docs', crawlDepth: 2, inboundLinkCount: 7 }),
        page('/docs/nav', { pageType: 'docs', crawlDepth: 1, isInSiteNavigation: true }),
      ],
    });
    expect(sections(llmsTxt).Docs).toEqual([`${ORIGIN}/docs/nav`, `${ORIGIN}/docs/linked`, `${ORIGIN}/docs/deep`]);
  });

  it('puts legal pages and overflow under an H2 named Optional, last', () => {
    const posts = Array.from({ length: 8 }, (_, index) => page(`/blog/post-${index}`, { pageType: 'blog' }));
    const llmsTxt = generate({ pages: [homepage, page('/terms', { pageType: 'legal' }), ...posts] });
    const listed = sections(llmsTxt);
    expect(Object.keys(listed).at(-1)).toBe('Optional');
    expect(listed.Blog).toHaveLength(5);
    expect(listed.Optional).toContain(`${ORIGIN}/terms`);
    expect(listed.Optional).toHaveLength(4);
  });

  it('keeps a flood of blog posts from crowding out core pages', () => {
    const posts = Array.from({ length: 200 }, (_, index) =>
      page(`/blog/post-${index}`, { pageType: 'blog', isInSiteNavigation: true, inboundLinkCount: 20 }),
    );
    const llmsTxt = generate({ pages: [homepage, ...posts, page('/docs/intro', { pageType: 'docs', crawlDepth: 2 })] });
    const listed = sections(llmsTxt);
    expect(listed.Docs).toEqual([`${ORIGIN}/docs/intro`]);
    expect(listed.Blog).toHaveLength(5);
    expect(listed.Optional).toHaveLength(40);
  });

  it('applies description overrides and exclusions', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/kept'), page('/dropped')],
      overrides: [
        { normalisedUrl: `${ORIGIN}/kept`, descriptionOverride: 'Written by the user.', isExcluded: false },
        { normalisedUrl: `${ORIGIN}/dropped`, descriptionOverride: null, isExcluded: true },
      ],
    });
    expect(llmsTxt).toContain(`- [Title of /kept](${ORIGIN}/kept): Written by the user.`);
    expect(llmsTxt).not.toContain('/dropped');
  });

  it('links the .md variant when one exists, and the URL as the site links it otherwise', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/guide', { markdownVariantUrl: `${ORIGIN}/guide.md` }),
        page('/about', { fetchUrl: `${ORIGIN}/about/` }),
      ],
    });
    expect(llmsTxt).toContain(`](${ORIGIN}/guide.md)`);
    expect(llmsTxt).toContain(`](${ORIGIN}/about/)`);
  });

  it('leaves out pages with a noindex directive', () => {
    expect(generate({ pages: [homepage, page('/secret', { hasNoindexDirective: true })] })).not.toContain('/secret');
  });

  it('keeps one entry per canonical URL, preferring the page at that URL', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/product?ref=x', { canonicalUrl: `${ORIGIN}/product`, isInSiteNavigation: true }),
        page('/product', { canonicalUrl: `${ORIGIN}/product/` }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toEqual([`${ORIGIN}/product`]);
  });

  it('leaves out pagination and pages in another language than the site’s', () => {
    const llmsTxt = generate({
      pages: [
        page('/', { title: 'Example', languageCode: 'en-US' }),
        page('/blog/page/2', { pageType: 'blog' }),
        page('/blog?page=3', { pageType: 'blog' }),
        page('/de/docs', { pageType: 'docs', languageCode: 'de' }),
        page('/docs', { pageType: 'docs', languageCode: 'en' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toEqual([`${ORIGIN}/docs`]);
  });

  it('escapes brackets in titles, encodes parentheses in URLs and keeps each entry on one line', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/wiki/Thing_(disambiguation)', { title: 'The [best]\nthing', description: 'Line one.\n\nLine two.' }),
      ],
    });
    expect(llmsTxt).toContain(`- [The \\[best\\] thing](${ORIGIN}/wiki/Thing_%28disambiguation%29): Line one. Line two.`);
    expect(validateLlmsTxt(llmsTxt).isValid).toBe(true);
    expect([...listedEntries(llmsTxt).keys()]).toEqual([`${ORIGIN}/wiki/Thing_%28disambiguation%29`]);
  });

  it('drops the site name from titles and makes a title from the URL when there is none', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/docs/getting-started.html', { title: 'Getting started | Example' }), page('/release-notes', { title: null })],
    });
    expect(llmsTxt).toContain('- [Getting started](');
    expect(llmsTxt).toContain('- [Release notes](');
  });

  it('cuts long descriptions at a word boundary', () => {
    const llmsTxt = generate({ pages: [homepage, page('/long', { description: 'word '.repeat(200) })] });
    const line = llmsTxt.split('\n').find((candidate) => candidate.includes('/long'))!;
    expect(line.endsWith('word…')).toBe(true);
    expect(line.length).toBeLessThan(400);
  });
});

describe('isPaginationUrl', () => {
  it.each([
    [`${ORIGIN}/blog/page/2`, true],
    [`${ORIGIN}/blog?page=2`, true],
    [`${ORIGIN}/?p=4`, true],
    [`${ORIGIN}/page/about`, false],
    [`${ORIGIN}/blog?page=all`, false],
  ])('%s -> %s', (url, expected) => expect(isPaginationUrl(url)).toBe(expected));
});

describe('validateLlmsTxt', () => {
  const valid = ['# Site', '', '> Summary.', '', 'Some notes.', '', '## Docs', '', '- [A](https://a.example/a): About A', '- [B](https://a.example/b)', '', '## Optional', '', '- [C](https://a.example/c)', ''].join('\n');

  it('accepts a file with only an H1', () => {
    expect(validateLlmsTxt('# Site\n')).toEqual({ isValid: true, problems: [] });
  });

  it('accepts the full shape', () => {
    expect(validateLlmsTxt(valid)).toEqual({ isValid: true, problems: [] });
  });

  it('rejects a file that does not start with an H1, or has two', () => {
    expect(validateLlmsTxt('').isValid).toBe(false);
    expect(validateLlmsTxt('## Docs\n').problems[0]).toMatch(/start with an H1/);
    expect(validateLlmsTxt('# One\n# Two\n').problems[0]).toMatch(/only one H1/);
  });

  it('rejects H3 headings', () => {
    expect(validateLlmsTxt(`${valid}### Deeper\n`).problems).toEqual(['line 15: only H1 and H2 headings are allowed']);
  });

  it('rejects multi-line entries and other text inside a section', () => {
    const problems = validateLlmsTxt('# Site\n\n## Docs\n\n- [A](https://a.example/a): one\n  continued\n').problems;
    expect(problems).toEqual(['line 6: a section may only hold one-line "- [title](url): description" entries']);
  });

  it('rejects unescaped brackets and URLs with spaces', () => {
    expect(validateLlmsTxt('# Site\n\n## Docs\n\n- [a ] b](https://a.example)\n').isValid).toBe(false);
    expect(validateLlmsTxt('# Site\n\n## Docs\n\n- [a](https://a.example/a b)\n').isValid).toBe(false);
  });

  it('requires the skippable section to be named exactly Optional, once', () => {
    expect(validateLlmsTxt('# Site\n\n## optional\n').problems[0]).toMatch(/exactly "Optional"/);
    expect(validateLlmsTxt('# Site\n\n## Optional\n\n## Optional\n').problems[0]).toMatch(/appears twice/);
  });
});

describe('compareText', () => {
  it('compares runs of digits as numbers', () => {
    const urls = ['/posts/10', '/posts/2', '/posts/1', '/posts/b', '/posts/a', '/posts/02'];
    expect([...urls].sort(compareText)).toEqual(['/posts/1', '/posts/02', '/posts/2', '/posts/10', '/posts/a', '/posts/b']);
  });
});
