import { describe, expect, it } from 'vitest';
import type { GeneratorPage, PageType, StoredPageAssessment } from '@llms-txt/contracts';
import { listedEntries } from './decide-publication';
import { firstParagraphOf } from './entry-text';
import { generateLlmsTxt, type GenerateLlmsTxtInput } from './generate-llms-txt';
import { compareText, DEFAULT_SELECTION_LIMITS, excludePagesUnderUrlPrefixes, isPaginationUrl } from './select-pages';
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
  contentDigest?: string;
  contentMarkdown?: string;
  navigationLabel?: string | null;
  navigationPosition?: number | null;
  firstLinkPosition?: number | null;
  declaredSiteName?: string | null;
  assessment?: StoredPageAssessment;
}

function page(path: string, options: PageOptions = {}): GeneratorPage {
  const normalisedUrl = path === '/' ? ORIGIN : `${ORIGIN}${path}`;
  return {
    record: {
      normalisedUrl,
      canonicalUrl: options.canonicalUrl ?? null,
      title: options.title === undefined ? `Title of ${path}` : options.title,
      description: options.description === undefined ? `What the page at ${path} is about.` : options.description,
      declaredSiteName: options.declaredSiteName ?? null,
      pageType: options.pageType ?? (path === '/' ? 'home' : 'other'),
      languageCode: options.languageCode ?? null,
      contentMarkdown: options.contentMarkdown ?? '',
      contentDigest: options.contentDigest ?? `digest of ${path}`,
      listingFieldsHash: 'hash',
    },
    assessment: options.assessment ?? null,
    fetchUrl: options.fetchUrl ?? normalisedUrl,
    crawlSignals: {
      crawlDepth: options.crawlDepth ?? (path === '/' ? 0 : 1),
      discoveredVia: 'navigation',
      hasNoindexDirective: options.hasNoindexDirective ?? false,
      isInSiteNavigation: options.isInSiteNavigation ?? false,
      inboundLinkCount: options.inboundLinkCount ?? 0,
      navigationLabel: options.navigationLabel ?? null,
      navigationPosition: options.navigationPosition ?? null,
      firstLinkPosition: options.firstLinkPosition ?? null,
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

describe('generateLlmsTxt with page assessments', () => {
  const assessed = (overrides: Partial<StoredPageAssessment>): StoredPageAssessment => ({
    description: 'Written from the content.',
    listingValue: 'primary',
    exclusionReason: null,
    pageType: 'docs',
    sourceHash: 'source',
    ...overrides,
  });

  it('leaves out pages judged not to belong, such as a not-found page served with a 200', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/docs', { pageType: 'docs', assessment: assessed({}) }),
        page('/gone', { assessment: assessed({ listingValue: 'exclude', exclusionReason: 'error_page' }) }),
        page('/blog/launch', {
          pageType: 'blog',
          assessment: assessed({ listingValue: 'exclude', exclusionReason: 'individual_content', pageType: 'blog' }),
        }),
      ],
    });
    expect(sections(llmsTxt)).toEqual({ Docs: [`${ORIGIN}/docs`] });
  });

  it('uses the assessed description and page type, and puts optional pages under Optional', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/resources/start', { title: 'Start', pageType: 'other', assessment: assessed({ pageType: 'guide' }) }),
        page('/partners', { pageType: 'about', assessment: assessed({ listingValue: 'optional', pageType: 'about' }) }),
      ],
    });
    expect(sections(llmsTxt)).toEqual({ Guides: [`${ORIGIN}/resources/start`], Optional: [`${ORIGIN}/partners`] });
    expect(llmsTxt).toContain(`- [Start](${ORIGIN}/resources/start): Written from the content.`);
  });

  it('lets a workspace override win over the assessed description', () => {
    const docs = page('/docs', { pageType: 'docs', assessment: assessed({}) });
    const llmsTxt = generate({
      pages: [homepage, docs],
      overrides: [{ normalisedUrl: docs.record.normalisedUrl, descriptionOverride: 'My words.', isExcluded: false }],
    });
    expect(llmsTxt).toContain(': My words.');
  });
});

describe('generateLlmsTxt', () => {
  it('renders the H1, the summary and the sections, in the spec’s order', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/docs/intro', { pageType: 'docs', title: 'Intro', description: 'Start here to learn the basics.' })],
    });
    expect(llmsTxt).toBe(
      ['# Example', '', '> Example makes examples.', '', '## Docs', '', `- [Intro](${ORIGIN}/docs/intro): Start here to learn the basics.`, ''].join('\n'),
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

  it('puts the notes between the summary and the first section, one line each', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/docs', { pageType: 'docs' })],
      siteNotes: ['The v1 API is deprecated;\nuse v2.', ' '],
    });
    expect(llmsTxt).toContain('> Example makes examples.\n\n- The v1 API is deprecated; use v2.\n\n## Docs\n');
    expect(validateLlmsTxt(llmsTxt).isValid).toBe(true);
  });

  it('lists the site’s machine-readable files after its pages and before Optional', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/docs', { pageType: 'docs' }), page('/terms', { pageType: 'legal' })],
      machineReadableResourceUrls: [
        `${ORIGIN}/api/openapi.json`,
        `${ORIGIN}/workers/llms.txt`,
        `${ORIGIN}/llms-full.txt`,
        `${ORIGIN}/not-a-resource.txt`,
        `${ORIGIN}/llms-full.txt`,
      ],
    });
    expect(Object.keys(sections(llmsTxt))).toEqual(['Docs', 'Machine-readable resources', 'Optional']);
    expect(llmsTxt).toContain(
      [
        `- [llms-full.txt](${ORIGIN}/llms-full.txt): The full text of the site's pages in one file.`,
        `- [workers/llms.txt](${ORIGIN}/workers/llms.txt): An llms.txt index for this part of the site.`,
        `- [api/openapi.json](${ORIGIN}/api/openapi.json): Machine-readable OpenAPI description of the API.`,
      ].join('\n'),
    );
  });

  it('has no notes and no section of machine-readable files when there are none', () => {
    const pages = [homepage, page('/docs', { pageType: 'docs' })];
    expect(generate({ pages, siteNotes: [], machineReadableResourceUrls: [] })).toBe(generate({ pages }));
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

  it('puts legal pages under an H2 named Optional, last, and leaves out pages beyond a section’s limit', () => {
    const posts = Array.from({ length: 8 }, (_, index) => page(`/blog/post-${index}`, { pageType: 'blog' }));
    const llmsTxt = generate({ pages: [homepage, page('/terms', { pageType: 'legal' }), ...posts] });
    const listed = sections(llmsTxt);
    expect(Object.keys(listed)).toEqual(['Blog', 'Optional']);
    expect(listed.Blog).toEqual([`${ORIGIN}/blog/post-0`, `${ORIGIN}/blog/post-1`, `${ORIGIN}/blog/post-2`]);
    expect(listed.Optional).toEqual([`${ORIGIN}/terms`]);
  });

  it('keeps a flood of blog posts from crowding out core pages', () => {
    const posts = Array.from({ length: 200 }, (_, index) =>
      page(`/blog/post-${index}`, { pageType: 'blog', isInSiteNavigation: true, inboundLinkCount: 20 }),
    );
    const llmsTxt = generate({ pages: [homepage, ...posts, page('/docs/intro', { pageType: 'docs', crawlDepth: 2 })] });
    const listed = sections(llmsTxt);
    expect(listed.Docs).toEqual([`${ORIGIN}/docs/intro`]);
    expect(listed.Blog).toHaveLength(3);
    expect(listed.Optional).toBeUndefined();
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

  it('leaves out every page at or under an excluded URL prefix, keeping description overrides', () => {
    const pages = [homepage, page('/blog'), page('/blog/post'), page('/blog-archive'), page('/docs/intro')];
    const overrides = excludePagesUnderUrlPrefixes(
      [
        { normalisedUrl: `${ORIGIN}/blog/post`, descriptionOverride: 'Kept for later.', isExcluded: false },
        { normalisedUrl: `${ORIGIN}/docs/intro`, descriptionOverride: 'Written by the user.', isExcluded: false },
      ],
      [`${ORIGIN}/blog`],
      pages,
    );
    expect(overrides).toEqual([
      { normalisedUrl: `${ORIGIN}/blog/post`, descriptionOverride: 'Kept for later.', isExcluded: true },
      { normalisedUrl: `${ORIGIN}/docs/intro`, descriptionOverride: 'Written by the user.', isExcluded: false },
      { normalisedUrl: `${ORIGIN}/blog`, descriptionOverride: null, isExcluded: true },
    ]);
    expect([...listedEntries(generate({ pages, overrides })).keys()]).toEqual([`${ORIGIN}/blog-archive`, `${ORIGIN}/docs/intro`]);
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

  it('lists URL variants with the same content once, preferring the one with a markdown version', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/guide.html', { contentDigest: 'guide' }),
        page('/guide', { contentDigest: 'guide', markdownVariantUrl: `${ORIGIN}/guide.md` }),
        page('/guide/index.html', { contentDigest: 'guide' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toEqual([`${ORIGIN}/guide.md`]);
  });

  it('keeps pages at similar URLs when their content differs', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/guide', { contentDigest: 'one' }), page('/guide.html', { contentDigest: 'two' })],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toHaveLength(2);
  });

  it('leaves out the homepage under its other URLs', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/index', { contentDigest: 'digest of /' }),
        page('/index.html', { contentDigest: 'digest of /' }),
        page('/about', { contentDigest: 'about' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toEqual([`${ORIGIN}/about`]);
  });

  it('titles a page from its URL when its title is only the site name', () => {
    const llmsTxt = generate({ pages: [homepage, page('/getting-started.html', { title: 'Example', contentDigest: 'start' })] });
    expect(llmsTxt).toContain(`- [Getting Started](${ORIGIN}/getting-started.html)`);
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
    expect(llmsTxt).toContain('- [Release Notes](');
  });

  it('cuts long descriptions at a word boundary', () => {
    const llmsTxt = generate({ pages: [homepage, page('/long', { description: 'word '.repeat(200) })] });
    const line = llmsTxt.split('\n').find((candidate) => candidate.includes('/long'))!;
    expect(line.endsWith('word…')).toBe(true);
    expect(line.length).toBeLessThan(400);
  });
});

describe('which pages are listed', () => {
  const listedUrls = (pages: GeneratorPage[]) => Object.values(sections(generate({ pages: [homepage, ...pages] }))).flat();

  it.each([
    ['/accounts/login', 'a login page'],
    ['/signup', 'a sign-up page'],
    ['/cart', 'a cart'],
    ['/jobs/create', 'an action on a section'],
    ['/search', 'a search page'],
    ['/welcome?next=/account', 'a step on the way to another page'],
    ['/stories/category/arts', 'a category listing'],
    ['/blog/tag/releases', 'a tag listing'],
    ['/events/past', 'a listing of what is over'],
    ['/events/8219', 'a numbered record'],
    ['/jobs/location/berlin', 'a page under a job board'],
  ])('leaves out %s: %s', (path) => {
    expect(listedUrls([page(path), page('/kept')])).toEqual([`${ORIGIN}/kept`]);
  });

  it('keeps documentation at URLs that name logins, tags and numbers', () => {
    const pages = [
      page('/docs/auth/login', { pageType: 'docs' }),
      page('/docs/api/tags', { pageType: 'api' }),
      page('/docs/errors/404', { pageType: 'docs' }),
    ];
    expect(listedUrls(pages)).toHaveLength(3);
  });

  it('keeps a numbered page the navigation links, and numbered blog posts', () => {
    expect(listedUrls([page('/report/2024', { isInSiteNavigation: true })])).toEqual([`${ORIGIN}/report/2024`]);
    expect(listedUrls([page('/posts/17', { pageType: 'blog' })])).toEqual([`${ORIGIN}/posts/17`]);
  });

  it('leaves out a large family of deep sibling pages, but not documentation or navigation pages', () => {
    const releases = Array.from({ length: 5 }, (_, index) => page(`/downloads/release/version-${index}`));
    const references = Array.from({ length: 5 }, (_, index) => page(`/docs/reference/part-${index}`, { pageType: 'docs' }));
    const inNavigation = page('/downloads/release/latest', { isInSiteNavigation: true });
    const listed = listedUrls([page('/downloads'), ...releases, ...references, inNavigation]);
    expect(listed).toEqual(expect.arrayContaining([`${ORIGIN}/downloads`, `${ORIGIN}/downloads/release/latest`]));
    expect(listed.filter((url) => url.includes('/release/version-'))).toEqual([]);
    expect(listed.filter((url) => url.includes('/docs/reference/'))).toHaveLength(5);
  });

  it('keeps a small family of deep sibling pages', () => {
    const pages = Array.from({ length: 4 }, (_, index) => page(`/downloads/release/version-${index}`));
    expect(listedUrls(pages)).toHaveLength(4);
  });

  it('leaves out a page that serves the homepage’s content at another URL', () => {
    expect(listedUrls([page('/shell', { contentDigest: 'digest of /' }), page('/kept')])).toEqual([`${ORIGIN}/kept`]);
  });

  it('lists everything a small site has, however weakly linked', () => {
    const pages = Array.from({ length: 8 }, (_, index) => page(`/page-${index}`, { crawlDepth: 3 }));
    expect(listedUrls(pages)).toHaveLength(8);
  });

  it('leaves out weakly linked pages of a large site, except documentation', () => {
    const strong = Array.from({ length: 12 }, (_, index) => page(`/strong-${index}`, { isInSiteNavigation: true }));
    const weak = page('/weak', { crawlDepth: 2, inboundLinkCount: 1 });
    const weakDocs = page('/docs/weak', { pageType: 'docs', crawlDepth: 2, inboundLinkCount: 1 });
    const listed = listedUrls([...strong, weak, weakDocs]);
    expect(listed).not.toContain(`${ORIGIN}/weak`);
    expect(listed).toContain(`${ORIGIN}/docs/weak`);
  });

  it('does not let a template that links a page from everywhere outrank the navigation', () => {
    const linkedEverywhere = page('/filters', { inboundLinkCount: 5000 });
    const inNavigation = page('/product', { isInSiteNavigation: true });
    expect(listedUrls([linkedEverywhere, inNavigation])).toEqual([`${ORIGIN}/product`, `${ORIGIN}/filters`]);
  });

  it('orders pages that score the same and are not in the navigation as the site links them', () => {
    // A docs sidebar: every page links every other, so they all score the same.
    const pages = [
      page('/docs/accent-color', { firstLinkPosition: 40 }),
      page('/docs/installation', { firstLinkPosition: 2 }),
      page('/docs/core-concepts', { firstLinkPosition: 3 }),
      page('/docs/found-in-sitemap-only'),
    ];
    expect(listedUrls(pages)).toEqual(
      ['installation', 'core-concepts', 'accent-color', 'found-in-sitemap-only'].map((name) => `${ORIGIN}/docs/${name}`),
    );
  });

  it('orders pages that score the same as the navigation does', () => {
    const pages = [
      page('/android', { isInSiteNavigation: true, navigationPosition: 3 }),
      page('/windows', { isInSiteNavigation: true, navigationPosition: 1 }),
      page('/macos', { isInSiteNavigation: true, navigationPosition: 2 }),
    ];
    expect(listedUrls(pages)).toEqual([`${ORIGIN}/windows`, `${ORIGIN}/macos`, `${ORIGIN}/android`]);
  });

  it('fills the sections a round at a time when the file is full, documentation two at a time', () => {
    const docs = Array.from({ length: 6 }, (_, index) => page(`/docs/page-${index}`, { pageType: 'docs', isInSiteNavigation: true }));
    const about = Array.from({ length: 6 }, (_, index) => page(`/about/page-${index}`, { pageType: 'about', isInSiteNavigation: true }));
    const product = Array.from({ length: 6 }, (_, index) => page(`/product/page-${index}`, { pageType: 'product', isInSiteNavigation: true }));
    const llmsTxt = generate({
      pages: [homepage, ...docs, ...about, ...product],
      limits: { ...DEFAULT_SELECTION_LIMITS, maxPrimaryEntries: 8 },
    });
    const listed = sections(llmsTxt);
    expect([listed.Docs!.length, listed.Product!.length, listed.About!.length]).toEqual([4, 2, 2]);
  });
});

describe('sections', () => {
  it('gives an area of the site its own section, named by the navigation', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/community', { isInSiteNavigation: true, navigationLabel: 'Community' }),
        page('/community/forums'),
        page('/community/awards'),
        page('/success-stories'),
        page('/success-stories/one'),
        page('/success-stories/two'),
        page('/downloads'),
        page('/downloads/source'),
        page('/contact-us'),
      ],
    });
    const listed = sections(llmsTxt);
    expect(Object.keys(listed)).toEqual(['Community', 'Success Stories', 'Pages']);
    expect(listed.Community).toHaveLength(3);
    expect(listed.Pages).toEqual([`${ORIGIN}/contact-us`, `${ORIGIN}/downloads`, `${ORIGIN}/downloads/source`]);
    expect(validateLlmsTxt(llmsTxt).isValid).toBe(true);
  });

  it('puts an area named like a page-type section in that section', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/handbook', { isInSiteNavigation: true, navigationLabel: 'docs' }),
        page('/handbook/a'),
        page('/handbook/b'),
        page('/docs/intro', { pageType: 'docs' }),
      ],
    });
    expect(Object.keys(sections(llmsTxt))).toEqual(['Docs']);
  });

  it('puts a job board under Optional', () => {
    const llmsTxt = generate({ pages: [homepage, page('/jobs', { pageType: 'about' }), page('/about', { pageType: 'about' })] });
    expect(sections(llmsTxt)).toEqual({ About: [`${ORIGIN}/about`], Optional: [`${ORIGIN}/jobs`] });
  });
});

describe('entry titles', () => {
  const titleOf = (llmsTxt: string, path: string) =>
    /^- \[(.*)\]\(/.exec(llmsTxt.split('\n').find((line) => line.includes(`(${ORIGIN}${path})`)) ?? '')?.[1];

  it('uses the navigation’s label when the title is a sentence, a headline, or the homepage’s', () => {
    const llmsTxt = generate({
      pages: [
        page('/', { title: 'Welcome to Example' }),
        page('/get-involved', { title: 'Hey community members!', navigationLabel: 'Get Involved' }),
        page('/psf', { title: 'Welcome to Example', navigationLabel: 'Foundation' }),
        page('/news', { title: 'A headline that goes on and on. '.repeat(4).trim(), navigationLabel: 'News' }),
        page('/donations', { title: 'Support us with a donation!' }),
      ],
    });
    expect(titleOf(llmsTxt, '/get-involved')).toBe('Get Involved');
    expect(titleOf(llmsTxt, '/psf')).toBe('Foundation');
    expect(titleOf(llmsTxt, '/news')).toBe('News');
    expect(titleOf(llmsTxt, '/donations')).toBe('Donations');
  });

  it('tells pages with one title apart by their navigation labels or URLs', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/events', { title: 'Our Events', isInSiteNavigation: true, navigationLabel: 'Events', navigationPosition: 1 }),
        page('/events/python-events', { title: 'Our Events', navigationLabel: 'Python Events' }),
        page('/events/user-groups', { title: 'Our Events' }),
      ],
    });
    expect(titleOf(llmsTxt, '/events')).toBe('Our Events');
    expect(titleOf(llmsTxt, '/events/python-events')).toBe('Python Events');
    expect(titleOf(llmsTxt, '/events/user-groups')).toBe('User Groups');
  });

  it('drops a name that several titles end with, and the page’s own host', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/foundation/stories', { title: 'Stories | Example Foundation' }),
        page('/foundation/board', { title: 'Board | Example Foundation' }),
        page('/proposals', { title: 'Index of proposals | example.com' }),
      ],
    });
    expect(titleOf(llmsTxt, '/foundation/stories')).toBe('Stories');
    expect(titleOf(llmsTxt, '/foundation/board')).toBe('Board');
    expect(titleOf(llmsTxt, '/proposals')).toBe('Index of proposals');
  });
});

describe('entry descriptions', () => {
  const boilerplate = 'The official home of the Example project.';
  const lineOf = (llmsTxt: string, path: string) => llmsTxt.split('\n').find((line) => line.includes(`(${ORIGIN}${path})`));

  it('leaves out a description the site repeats, and uses the page’s opening paragraph instead', () => {
    const llmsTxt = generate({
      pages: [
        page('/', { title: 'Example', description: boilerplate }),
        page('/about', {
          description: boilerplate,
          contentMarkdown: '## About\n\n- [A link](https://example.com/x)\n\nExample is a tool for making examples of every kind. It is free.',
        }),
        page('/downloads', { description: boilerplate, contentMarkdown: '## Releases\n\n| Version | Date |\n| --- | --- |' }),
        page('/own', { description: 'This page has a description of its own.' }),
      ],
    });
    expect(lineOf(llmsTxt, '/about')).toBe(
      `- [Title of /about](${ORIGIN}/about): Example is a tool for making examples of every kind. It is free.`,
    );
    expect(lineOf(llmsTxt, '/downloads')).toBe(`- [Title of /downloads](${ORIGIN}/downloads)`);
    expect(lineOf(llmsTxt, '/own')).toContain(': This page has a description of its own.');
  });

  it('counts a description as the site’s own when three pages with different content share it', () => {
    const shared = 'Everything you need to know about us.';
    const llmsTxt = generate({
      pages: [homepage, page('/a', { description: shared }), page('/b', { description: shared }), page('/c', { description: shared })],
    });
    expect(llmsTxt).not.toContain(shared);
  });

  it('leaves out a description that is a fragment of a few words, or that repeats the title', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/logos', { description: 'Inline image sizing' }), page('/faq', { title: 'Questions we are asked', description: 'Questions we are asked.' })],
    });
    expect(lineOf(llmsTxt, '/logos')).toBe(`- [Title of /logos](${ORIGIN}/logos)`);
    const short = generate({ pages: [homepage, page('/docs/intro', { description: 'Start here.' })] });
    expect(lineOf(short, '/docs/intro')).toContain(': Start here.');
    expect(lineOf(llmsTxt, '/faq')).toBe(`- [Questions we are asked](${ORIGIN}/faq)`);
  });
});

describe('firstParagraphOf', () => {
  it('skips headings, lists, tables, code, link-only lines, fragments and quotations', () => {
    const markdown = [
      '# Title',
      '- [Home](https://example.com/)\n- Logo',
      '[For more information visit the developer guide, which is elsewhere.](https://example.com/guide)',
      'Version Maintenance status First released End of support Release schedule',
      '```\nconst notProse = "A sentence inside a code block that is long enough to count.";\n```',
      'New to the community? Here are some great places to get started:',
      '"Example is fast enough for our site and lets us ship features in record time," said a user.',
      '-- A user, lead designer of something well known. Quoted in an interview.',
      'Example builds static sites from **markdown** and [templates](https://example.com/t), and keeps rebuilds fast.',
    ].join('\n\n');
    expect(firstParagraphOf(markdown)).toBe('Example builds static sites from markdown and templates, and keeps rebuilds fast.');
  });

  it('stops at the end of a sentence once the description is long enough', () => {
    const sentence = 'This sentence is exactly as long as it needs to be to fill some of the line.';
    const paragraph = Array.from({ length: 6 }, () => sentence).join(' ');
    expect(firstParagraphOf(paragraph)).toBe([sentence, sentence, sentence].join(' '));
  });

  it('returns null when the content has no prose', () => {
    expect(firstParagraphOf('## Only a heading\n\n- and a list')).toBeNull();
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
