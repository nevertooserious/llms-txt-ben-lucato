import { describe, expect, it } from 'vitest';
import type { GeneratorPage, PageType, StoredPageAssessment } from '@llms-txt/contracts';
import { listedEntries } from '../publication/decide-publication';
import { generateLlmsTxt, type GenerateLlmsTxtInput } from './generate-llms-txt';
import { compareText, excludePagesUnderUrlPrefixes, isPaginationUrl } from '../selection';
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
  /** Paths of the pages this page links. */
  linksTo?: string[];
  fetchUrl?: string;
  contentDigest?: string;
  contentMarkdown?: string;
  navigationLabel?: string | null;
  navigationPosition?: number | null;
  firstLinkPosition?: number | null;
  declaredSiteName?: string | null;
  /** By default the page is assessed as primary, keeping its description and type. */
  assessment?: StoredPageAssessment | null;
}

function page(path: string, options: PageOptions = {}): GeneratorPage {
  const normalisedUrl = path === '/' ? ORIGIN : `${ORIGIN}${path}`;
  const description = options.description === undefined ? `What the page at ${path} is about.` : options.description;
  const pageType = options.pageType ?? (path === '/' ? 'home' : 'other');
  const defaultAssessment: StoredPageAssessment | null =
    pageType === 'home'
      ? null
      : { description: description ?? '', listingValue: 'primary', exclusionReason: null, scope: 'broad', pageType, sourceHash: 'source' };
  return {
    record: {
      normalisedUrl,
      canonicalUrl: options.canonicalUrl ?? null,
      title: options.title === undefined ? `Title of ${path}` : options.title,
      description,
      declaredSiteName: options.declaredSiteName ?? null,
      pageType,
      languageCode: options.languageCode ?? null,
      contentMarkdown: options.contentMarkdown ?? '',
      contentDigest: options.contentDigest ?? `digest of ${path}`,
      listingFieldsHash: 'hash',
    },
    assessment: options.assessment === undefined ? defaultAssessment : options.assessment,
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
    outboundLinkUrls: (options.linksTo ?? []).map((path) => `${ORIGIN}${path}`),
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
    exclusionReason: null, scope: 'broad',
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
          assessment: assessed({ listingValue: 'exclude', exclusionReason: 'individual_content', scope: 'broad', pageType: 'blog' }),
        }),
      ],
    });
    expect(sections(llmsTxt)).toEqual({ Docs: [`${ORIGIN}/docs`] });
  });

  it('leaves out the rest of a folder when most of its pages are reference entries', () => {
    const referenceEntry = assessed({ listingValue: 'exclude', exclusionReason: 'reference_entry' });
    const options = ['a', 'b', 'c', 'd', 'e'].map((name) => page(`/config/${name}`, { pageType: 'docs', assessment: referenceEntry }));
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/config', { pageType: 'docs', assessment: assessed({}) }),
        ...options,
        // The model judged these two differently from their siblings.
        page('/config/f', { pageType: 'docs', assessment: assessed({}) }),
        page('/config/g', { pageType: 'docs', assessment: assessed({ listingValue: 'optional' }) }),
        page('/config/pinned', { pageType: 'docs', isInSiteNavigation: true, assessment: assessed({}) }),
        page('/guide/setup', { pageType: 'docs', assessment: assessed({}) }),
      ],
    });
    expect(sections(llmsTxt)).toEqual({ Docs: [`${ORIGIN}/config/pinned`, `${ORIGIN}/config`, `${ORIGIN}/guide/setup`] });
  });

  it('keeps a reference folder whose index page is not there to stand for it', () => {
    const referenceEntry = assessed({ listingValue: 'exclude', exclusionReason: 'reference_entry' });
    const entries = ['a', 'b', 'c', 'd', 'e'].map((name) => page(`/config/${name}`, { pageType: 'docs', assessment: referenceEntry }));
    const llmsTxt = generate({ pages: [homepage, ...entries, page('/config/guide', { pageType: 'docs', assessment: assessed({}) })] });
    expect(sections(llmsTxt)).toEqual({ Docs: [`${ORIGIN}/config/guide`] });
  });

  it('does not count a folder index.html as one of the pages it stands for', () => {
    const referenceEntry = assessed({ listingValue: 'exclude', exclusionReason: 'reference_entry' });
    const entries = ['a', 'b', 'c', 'd', 'e'].map((name) => page(`/config/${name}`, { pageType: 'docs', assessment: referenceEntry }));
    const llmsTxt = generate({ pages: [homepage, page('/config/index.html', { pageType: 'docs', assessment: assessed({}) }), ...entries] });
    expect(sections(llmsTxt)).toEqual({ Docs: [`${ORIGIN}/config/index.html`] });
  });

  it('leaves out a narrow page when a broader page above it is listed', () => {
    const narrow = assessed({ scope: 'narrow' });
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/3/tutorial/index.html', { pageType: 'docs', assessment: assessed({}) }),
        page('/3/tutorial/controlflow.html', { pageType: 'docs', assessment: narrow }),
        page('/3/tutorial/classes.html', { pageType: 'docs', isInSiteNavigation: true, assessment: narrow }),
        page('/guides/only-guide', { pageType: 'docs', assessment: narrow }),
      ],
    });
    expect(sections(llmsTxt)).toEqual({
      Docs: [`${ORIGIN}/guides/only-guide`, `${ORIGIN}/3/tutorial/index.html`],
    });
  });

  it('lists a page the user keeps, whatever the assessment said, unless the user also excludes it', () => {
    const rejected = page('/psf/strategy', {
      pageType: 'about',
      assessment: assessed({ listingValue: 'exclude', exclusionReason: 'not_useful_to_assistant', pageType: 'about' }),
    });
    const keep = { normalisedUrl: rejected.record.normalisedUrl, descriptionOverride: null, isExcluded: false, isKept: true };
    expect(sections(generate({ pages: [homepage, rejected], overrides: [keep] }))).toEqual({ About: [`${ORIGIN}/psf/strategy`] });
    expect(sections(generate({ pages: [homepage, rejected], overrides: [{ ...keep, isExcluded: true }] }))).toEqual({});
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

  it('lets a user override win over the assessed description', () => {
    const docs = page('/docs', { pageType: 'docs', assessment: assessed({}) });
    const llmsTxt = generate({
      pages: [homepage, docs],
      overrides: [{ normalisedUrl: docs.record.normalisedUrl, descriptionOverride: 'My words.', isExcluded: false, isKept: false }],
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
        `${ORIGIN}/llms-small.txt`,
        `${ORIGIN}/llms-full.txt`,
        `${ORIGIN}/not-a-resource.txt`,
        `${ORIGIN}/llms-full.txt`,
      ],
    });
    expect(Object.keys(sections(llmsTxt))).toEqual(['Docs', 'Machine-readable resources', 'Optional']);
    expect(llmsTxt).toContain(
      [
        `- [llms-full.txt](${ORIGIN}/llms-full.txt): The full text of the site's pages in one file.`,
        `- [llms-small.txt](${ORIGIN}/llms-small.txt): Another version of the site's text in one file, often shorter than the full one.`,
        `- [workers/llms.txt](${ORIGIN}/workers/llms.txt): An llms.txt index for this part of the site.`,
        `- [api/openapi.json](${ORIGIN}/api/openapi.json): Machine-readable OpenAPI description of the API.`,
      ].join('\n'),
    );
  });

  it('titles a machine-readable file by its path as written when the path cannot be decoded', () => {
    const llmsTxt = generate({ pages: [homepage], machineReadableResourceUrls: [`${ORIGIN}/docs%ff/llms.txt`] });
    expect(llmsTxt).toContain(`- [docs%ff/llms.txt](${ORIGIN}/docs%ff/llms.txt): `);
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

  it('puts legal pages under an H2 named Optional, last', () => {
    const llmsTxt = generate({ pages: [homepage, page('/terms', { pageType: 'legal' }), page('/docs', { pageType: 'docs' })] });
    const listed = sections(llmsTxt);
    expect(Object.keys(listed)).toEqual(['Docs', 'Optional']);
    expect(listed.Optional).toEqual([`${ORIGIN}/terms`]);
  });

  it('lists every useful page, with no limit on a section or the file', () => {
    const docs = Array.from({ length: 60 }, (_, index) => page(`/docs/page-${index}`, { pageType: 'docs', crawlDepth: 3 }));
    expect(sections(generate({ pages: [homepage, ...docs] })).Docs).toHaveLength(60);
  });

  it('applies description overrides and exclusions', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/kept'), page('/dropped')],
      overrides: [
        { normalisedUrl: `${ORIGIN}/kept`, descriptionOverride: 'Written by the user.', isExcluded: false, isKept: false },
        { normalisedUrl: `${ORIGIN}/dropped`, descriptionOverride: null, isExcluded: true, isKept: false },
      ],
    });
    expect(llmsTxt).toContain(`- [Title of /kept](${ORIGIN}/kept): Written by the user.`);
    expect(llmsTxt).not.toContain('/dropped');
  });

  it('leaves out every page at or under an excluded URL prefix, keeping description overrides', () => {
    const pages = [homepage, page('/blog'), page('/blog/post'), page('/blog-archive'), page('/docs/intro')];
    const overrides = excludePagesUnderUrlPrefixes(
      [
        { normalisedUrl: `${ORIGIN}/blog/post`, descriptionOverride: 'Kept for later.', isExcluded: false, isKept: false },
        { normalisedUrl: `${ORIGIN}/docs/intro`, descriptionOverride: 'Written by the user.', isExcluded: false, isKept: false },
      ],
      [`${ORIGIN}/blog`],
      pages,
    );
    expect(overrides).toEqual([
      { normalisedUrl: `${ORIGIN}/blog/post`, descriptionOverride: 'Kept for later.', isExcluded: true, isKept: false },
      { normalisedUrl: `${ORIGIN}/docs/intro`, descriptionOverride: 'Written by the user.', isExcluded: false, isKept: false },
      { normalisedUrl: `${ORIGIN}/blog`, descriptionOverride: null, isExcluded: true, isKept: false },
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

  describe('the homepage’s markdown file', () => {
    const docs = page('/docs', { pageType: 'docs' });
    const terms = page('/terms', { pageType: 'legal' });

    it('is the first entry of the first section, titled by what the homepage’s title says besides the site’s name', () => {
      const specification = page('/', {
        title: 'The example file – Example',
        description: 'A proposal for example files.',
        markdownVariantUrl: `${ORIGIN}/index.md`,
      });
      const llmsTxt = generate({ pages: [specification, docs, terms], siteSummary: 'Example makes examples.' });
      expect(llmsTxt).toContain(
        `## Docs\n\n- [The example file](${ORIGIN}/index.md): A proposal for example files.\n- [Title of /docs](${ORIGIN}/docs)`,
      );
      expect(Object.keys(sections(llmsTxt))).toEqual(['Docs', 'Optional']);
      expect(validateLlmsTxt(llmsTxt).isValid).toBe(true);
    });

    it('is called Home, and described as what it is, when the homepage says no more than the file already does', () => {
      const llmsTxt = generate({ pages: [page('/', { title: 'Example', description: 'Example makes examples.', markdownVariantUrl: `${ORIGIN}/README.md` }), docs] });
      expect(llmsTxt).toContain(`> Example makes examples.\n\n## Docs\n\n- [Home](${ORIGIN}/README.md): The homepage's text as markdown.\n`);
    });

    it('gets a section of its own before Optional when no other section is there', () => {
      const llmsTxt = generate({ pages: [page('/', { title: 'Example', markdownVariantUrl: `${ORIGIN}/index.md` }), terms] });
      expect(Object.keys(sections(llmsTxt))).toEqual(['Pages', 'Optional']);
    });

    it('keeps its title from another page, which takes the navigation’s label', () => {
      const llmsTxt = generate({
        pages: [
          page('/', { title: 'Example', markdownVariantUrl: `${ORIGIN}/index.md` }),
          page('/start', { title: 'Home', pageType: 'docs', navigationLabel: 'Start here' }),
        ],
      });
      expect(llmsTxt).toContain(`- [Home](${ORIGIN}/index.md)`);
      expect(llmsTxt).toContain(`- [Start here](${ORIGIN}/start)`);
    });

    it('is not listed without a markdown file, or when the user excluded the homepage', () => {
      expect(generate({ pages: [homepage, docs] })).not.toContain('[Home]');
      const withMarkdown = page('/', { title: 'Example', markdownVariantUrl: `${ORIGIN}/index.md` });
      const overrides = [{ normalisedUrl: ORIGIN, descriptionOverride: null, isExcluded: true, isKept: false }];
      expect(generate({ pages: [withMarkdown, docs], overrides })).not.toContain('index.md');
    });
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
        page('/guide.html', { title: 'Guide', contentDigest: 'guide' }),
        page('/guide', { title: 'Guide', contentDigest: 'guide', markdownVariantUrl: `${ORIGIN}/guide.md` }),
        page('/guide/index.html', { title: 'Guide', contentDigest: 'guide' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toEqual([`${ORIGIN}/guide.md`]);
  });

  it('lists a page once when query strings serve the same content, at the URL without one', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/play?q=11', { title: 'Playground', contentDigest: 'play' }),
        page('/play', { title: 'Playground', contentDigest: 'play' }),
        page('/play?ts=next', { title: 'Playground', contentDigest: 'play' }),
        page('/article?id=7', { contentDigest: 'seven' }),
        page('/article?id=8', { contentDigest: 'eight' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([
      `${ORIGIN}/article?id=7`,
      `${ORIGIN}/article?id=8`,
      `${ORIGIN}/play`,
    ]);
  });

  it('lists the routes of a site that routes on the URL fragment as separate pages', () => {
    // Every route is the same document, so all of them declare the one canonical URL.
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/#/install', { contentDigest: 'install', canonicalUrl: ORIGIN }),
        page('/#/configure', { contentDigest: 'configure', canonicalUrl: ORIGIN }),
        page('/#/guide', { contentDigest: 'guide', canonicalUrl: ORIGIN, markdownVariantUrl: `${ORIGIN}/guide.md` }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([
      `${ORIGIN}/#/configure`,
      `${ORIGIN}/#/install`,
      `${ORIGIN}/guide.md`,
    ]);
  });

  it('lists one URL for pages with the same title and content, however the URLs differ, and the shortest of them', () => {
    // gnu.org: a language in the file name, and a file named after its directory.
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/gnu/gnu.en.html', { title: 'About', contentDigest: 'about' }),
        page('/gnu/gnu.html', { title: 'About', contentDigest: 'about' }),
        page('/software/software.html', { title: 'Software', contentDigest: 'software' }),
        page('/software', { title: 'Software', contentDigest: 'software' }),
        // Made from one template, with a title of their own: two pages.
        page('/posts/first', { title: 'First post', contentDigest: 'a post' }),
        page('/posts/second', { title: 'Second post', contentDigest: 'a post' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([
      `${ORIGIN}/gnu/gnu.html`,
      `${ORIGIN}/posts/first`,
      `${ORIGIN}/posts/second`,
      `${ORIGIN}/software`,
    ]);
  });

  it('leaves out a page again under a query string, even when its content differs a little', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/start.html', { title: 'Getting started', contentDigest: 'start' }),
        page('/start.html?distro=guix', { title: 'Getting started', contentDigest: 'start, guix' }),
        page('/start.html?distro=pureos', { title: 'Getting started', contentDigest: 'start, pureos' }),
        // A query string that selects another page changes the title.
        page('/article', { title: 'Articles', contentDigest: 'articles' }),
        page('/article?id=7', { title: 'The seventh article', contentDigest: 'seven' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([
      `${ORIGIN}/article`,
      `${ORIGIN}/article?id=7`,
      `${ORIGIN}/start.html`,
    ]);
  });

  it('leaves out the homepage again under a query string of another of its URLs', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/home.en.html', { title: 'Example', contentDigest: 'digest of /' }),
        page('/home.en.html?distro=guix', { title: 'Example', contentDigest: 'home, guix' }),
        page('/docs', { contentDigest: 'docs' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toEqual([`${ORIGIN}/docs`]);
  });

  it('leaves out a translation named by its file name, when the page exists without one', () => {
    const llmsTxt = generate({
      pages: [
        homepage,
        page('/philosophy.html', { languageCode: 'en', contentDigest: 'philosophy' }),
        // Declares the site's language, as gnu.org's Danish page does.
        page('/philosophy.da.html', { languageCode: 'en', contentDigest: 'filosofi' }),
        // Two letters that are no translation of anything.
        page('/about.me.html', { languageCode: 'en', contentDigest: 'me' }),
      ],
    });
    expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([`${ORIGIN}/about.me.html`, `${ORIGIN}/philosophy.html`]);
  });

  it('leaves out a source or export of a page in another format', () => {
    const llmsTxt = generate({
      pages: [homepage, page('/licenses/gpl.html'), page('/licenses/gpl.dbk'), page('/licenses/fdl.xml'), page('/licenses/gpl.texi')],
    });
    expect(Object.values(sections(llmsTxt)).flat()).toEqual([`${ORIGIN}/licenses/gpl.html`]);
  });

  describe('a listed index page that links many more pages than were crawled', () => {
    const packagePaths = Array.from({ length: 200 }, (_unused, index) => `/software/package-${index}`);
    const softwareIndex = (options: PageOptions = {}) => page('/software', { title: 'Software', linksTo: packagePaths, ...options });

    it('stands for the few that were crawled, which are a sample', () => {
      // gnu.org: the crawl read a dozen of several hundred packages before its time limit.
      const crawled = packagePaths.slice(0, 5).map((path) => page(path));
      const llmsTxt = generate({ pages: [homepage, softwareIndex(), ...crawled, page('/about')] });
      expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([`${ORIGIN}/about`, `${ORIGIN}/software`]);
    });

    it('keeps the pages when a fair share of what the index links was crawled', () => {
      // An index of 200 essays of which the crawl read 20: curated, not sampled.
      const crawled = packagePaths.slice(0, 20).map((path) => page(path));
      const llmsTxt = generate({ pages: [homepage, softwareIndex(), ...crawled] });
      expect(Object.values(sections(llmsTxt)).flat()).toHaveLength(21);
    });

    it('keeps a sampled page the navigation links, since the site chose it', () => {
      const crawled = [page(packagePaths[0]!, { isInSiteNavigation: true }), ...packagePaths.slice(1, 5).map((path) => page(path))];
      const llmsTxt = generate({ pages: [homepage, softwareIndex(), ...crawled] });
      expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([`${ORIGIN}/software`, `${ORIGIN}/software/package-0`]);
    });

    it('keeps the pages when the index is not listed, as nothing would stand for them', () => {
      const crawled = packagePaths.slice(0, 5).map((path) => page(path));
      const unlistedIndex = softwareIndex({ assessment: null });
      const llmsTxt = generate({ pages: [homepage, unlistedIndex, ...crawled] });
      expect(Object.values(sections(llmsTxt)).flat()).toHaveLength(5);
    });

    it('does not count a list of forty links as a family, such as an essay that links its translations', () => {
      const translations = Array.from({ length: 40 }, (_unused, index) => `/essays/essay.lang-${index}.html`);
      const essay = page('/essays/essay.html', { title: 'Essay', linksTo: [...translations, '/essays/another.html'] });
      const llmsTxt = generate({ pages: [homepage, essay, page('/essays/another.html')] });
      expect(Object.values(sections(llmsTxt)).flat().sort()).toEqual([`${ORIGIN}/essays/another.html`, `${ORIGIN}/essays/essay.html`]);
    });
  });

  it('takes both names off a title that ends with two, as gnu.org writes them', () => {
    const llmsTxt = generate({
      siteTitle: 'GNU',
      pages: [
        homepage,
        page('/philosophy/free-sw.html', { title: 'What is Free Software? - GNU Project - Free Software Foundation' }),
        page('/licenses/gpl-faq.html', { title: 'GPL FAQ - GNU Project - Free Software Foundation' }),
        page('/gnu/gnu.html', { title: 'About GNU - Free Software Foundation' }),
        // One page ending with a name of its own does not make that a site name.
        page('/gnu/manifesto.html', { title: 'The Manifesto - First Edition - Free Software Foundation' }),
      ],
    });
    expect(llmsTxt).toContain('- [What is Free Software?](');
    expect(llmsTxt).toContain('- [GPL FAQ](');
    expect(llmsTxt).toContain('- [About GNU](');
    expect(llmsTxt).toContain('- [The Manifesto - First Edition](');
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

  it('does not cut a long description through the middle of a character', () => {
    // No spaces to cut at, and the cut would fall between the two halves of the first emoji.
    const llmsTxt = generate({ pages: [homepage, page('/long', { description: `${'a'.repeat(298)}${'😀'.repeat(10)}` })] });
    const line = llmsTxt.split('\n').find((candidate) => candidate.includes('/long'))!;
    expect(line.endsWith(`${'a'.repeat(298)}…`)).toBe(true);
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

  it('lists a useful page however weakly the site links it', () => {
    const strong = Array.from({ length: 12 }, (_, index) => page(`/strong-${index}`, { isInSiteNavigation: true }));
    expect(listedUrls([...strong, page('/weak', { crawlDepth: 2, inboundLinkCount: 1 })])).toContain(`${ORIGIN}/weak`);
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

  it('gives no section to an area whose path segment has nothing to name it by', () => {
    const llmsTxt = generate({ pages: [homepage, page('/-/one'), page('/-/two'), page('/-/three')] });
    expect(Object.keys(sections(llmsTxt))).toEqual(['Pages']);
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
  it('leaves out a description that repeats the title', () => {
    const llmsTxt = generate({ pages: [homepage, page('/faq', { title: 'Questions we are asked', description: 'Questions we are asked.' })] });
    expect(llmsTxt).toContain(`- [Questions we are asked](${ORIGIN}/faq)\n`);
  });

  it('does not list a page that has not been assessed', () => {
    const llmsTxt = generate({ pages: [homepage, page('/kept'), page('/waiting', { assessment: null })] });
    expect(sections(llmsTxt)).toEqual({ Pages: [`${ORIGIN}/kept`] });
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
