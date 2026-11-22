import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf, isDocumentationPage, JOB_BOARD_SEGMENT } from './page-kinds';
import { canonicalKey, compareText, isPaginationUrl, pathSegmentsOf } from './url-paths';

/** Sibling pages three or more segments deep that make a family too large to list. */
const MINIMUM_PAGES_IN_COLLAPSED_FAMILY = 5;

/**
 * The pages that could be listed, by rules that need no LLM: not the homepage (it is the
 * H1) under any of its URLs or with its content at another URL, noindex pages,
 * pagination, utility pages (login, cart), archive listings (tag, category), numbered
 * records, what sits under a job board, large families of deep sibling pages, pages in
 * another language than the site's, files in a format that is not a web page, or a page
 * again under a query string; and one page for each content. These are the pages worth
 * paying to assess.
 */
export function listingCandidates(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const siteLanguage = primaryLanguageOf(pages);
  const homepage = homepageOf(pages);
  const pagesByUrl = new Map(pages.map((page) => [page.record.normalisedUrl, page]));
  return withoutLargeDeepFamilies(
    keepOnePerContent(
      pages.filter(
        (page) =>
          page.record.pageType !== 'home' &&
          page.crawlSignals.crawlDepth > 0 &&
          page.record.contentDigest !== homepage?.record.contentDigest &&
          !page.crawlSignals.hasNoindexDirective &&
          !isPaginationUrl(page.record.normalisedUrl) &&
          !isUtilityPage(page) &&
          !isArchiveOrRecordPage(page) &&
          !isOtherFormat(page) &&
          !isQueryVariantOfAnotherPage(page, pagesByUrl) &&
          !isOtherLanguage(page, siteLanguage, pagesByUrl),
      ),
    ),
  );
}

const UTILITY_SEGMENT =
  /^(?:log-?in|log-?out|sign-?in|sign-?out|sign-?up|register|accounts?|my-account|cart|basket|checkout|unsubscribe|password|reset-password|forgot-password|auth|oauth|sso)$/;
/** As the last path segment these are an action on the section, not a page of it. */
const UTILITY_ACTION_SEGMENT = /^(?:create|new|edit|submit|delete|search)$/;
/** A URL carrying one of these is a step on the way to another page. */
const RETURN_PARAMETER_NAMES = ['next', 'redirect', 'redirect_to', 'redirect_uri', 'return', 'return_to', 'returnto', 'returnurl', 'continue'];
const ARCHIVE_SEGMENT = /^(?:category|categories|tag|tags|author|authors|archive|archives)$/;
/** As the last path segment: a listing of what is over (`/events/past`). */
const ARCHIVE_LAST_SEGMENT = /^(?:past|archived?)$/;

/** Login, sign-up, cart, search and the like: pages to use the site with, not to read. */
function isUtilityPage(page: GeneratorPage): boolean {
  if (isDocumentationPage(page) || page.record.pageType === 'product') return false;
  const url = new URL(page.record.normalisedUrl);
  if (RETURN_PARAMETER_NAMES.some((name) => url.searchParams.has(name))) return true;
  const segments = pathSegmentsOf(page.record.normalisedUrl);
  return segments.some((segment) => UTILITY_SEGMENT.test(segment)) || UTILITY_ACTION_SEGMENT.test(segments.at(-1) ?? '');
}

/**
 * A tag, category or author listing, a page under a job board, or one numbered record
 * (`/events/8219`): the site's stream of content, not its structure. A numbered page the
 * navigation links (`/report/2024`) is one the site chose to show, and numbered blog
 * posts are left to the Blog section's own small limit.
 */
function isArchiveOrRecordPage(page: GeneratorPage): boolean {
  if (isDocumentationPage(page)) return false;
  const segments = pathSegmentsOf(page.record.normalisedUrl);
  const lastSegment = segments.at(-1) ?? '';
  if (segments.some((segment) => ARCHIVE_SEGMENT.test(segment)) || ARCHIVE_LAST_SEGMENT.test(lastSegment)) return true;
  // Postings and their filters come and go; the board is the durable page.
  if (segments.slice(0, -1).some((segment) => JOB_BOARD_SEGMENT.test(segment))) return true;
  return /^\d+$/.test(lastSegment) && !page.crawlSignals.isInSiteNavigation && page.record.pageType !== 'blog';
}

/**
 * Five or more sibling pages three or more path segments deep (`/jobs/location/berlin`,
 * `/downloads/release/3-12-1`) are one listing's items, and the listing page stands for
 * them. Documentation is often that deep and is kept, as is any page the navigation or
 * the site's own llms.txt names.
 */
function withoutLargeDeepFamilies(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const familyKeyOf = (page: GeneratorPage): string | null => {
    const { isInSiteNavigation, discoveredVia } = page.crawlSignals;
    if (isDocumentationPage(page) || isInSiteNavigation || discoveredVia === 'existing_llms_txt') return null;
    const segments = pathSegmentsOf(page.record.normalisedUrl);
    const depth = LOCALE_SEGMENT.test(segments[0] ?? '') ? segments.length - 1 : segments.length;
    return depth < 3 ? null : JSON.stringify([new URL(page.record.normalisedUrl).origin, segments.slice(0, -1)]);
  };
  const familySizes = new Map<string, number>();
  for (const page of pages) {
    const key = familyKeyOf(page);
    if (key !== null) familySizes.set(key, (familySizes.get(key) ?? 0) + 1);
  }
  return pages.filter((page) => {
    const key = familyKeyOf(page);
    return key === null || familySizes.get(key)! < MINIMUM_PAGES_IN_COLLAPSED_FAMILY;
  });
}

const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/;

/** A source or export of a page in another format, which sites link beside it (`gpl.dbk`, `fdl.xml`). */
const OTHER_FORMAT_EXTENSION = /\.(?:xml|dbk|sgml|texi|texinfo|tex|ps|dvi|rtf|odt|rss|atom|ics)$/i;

function isOtherFormat(page: GeneratorPage): boolean {
  return OTHER_FORMAT_EXTENSION.test(new URL(page.record.normalisedUrl).pathname);
}

/**
 * The same page again under a query string: the URL without it is a page of the site
 * with the same title (`/home.html?distro=guix`, `/docs?ref=nav`). That page stands for
 * it, whatever becomes of that page. A query string that selects another page changes the
 * title (`/article?id=7`), and stays.
 */
function isQueryVariantOfAnotherPage(page: GeneratorPage, pagesByUrl: ReadonlyMap<string, GeneratorPage>): boolean {
  const url = new URL(page.record.normalisedUrl);
  if (url.search === '') return false;
  url.search = '';
  const pageWithoutQuery = pagesByUrl.get(url.href) ?? pagesByUrl.get(url.href.replace(/\/$/, ''));
  return pageWithoutQuery !== undefined && page.record.title !== null && pageWithoutQuery.record.title === page.record.title;
}

/**
 * Two URLs with the same title and content are one page, however they differ: `/guide`,
 * `/guide.html`, `/guide.md`, `/guide/index.html`, `/guide.en.html`, `/guide?tab=2`, or a
 * file named after its directory (`/guide/guide.html`). The title counts because the
 * content digest leaves it out: pages made from one template with little text of their
 * own share a digest and are still different pages.
 */
function keepOnePerContent(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const byContent = new Map<string, GeneratorPage>();
  for (const page of pages) {
    const key = JSON.stringify([page.record.title, page.record.contentDigest]);
    const current = byContent.get(key);
    if (current === undefined || isBetterUrlOfContent(page, current)) byContent.set(key, page);
  }
  return [...byContent.values()];
}

/**
 * The URL the page declares as canonical wins, then one without a query string, then one
 * with a markdown version, then the shorter. Ignores crawl scores, so the listed URL does
 * not flip as inbound link counts change.
 */
function isBetterUrlOfContent(candidate: GeneratorPage, current: GeneratorPage): boolean {
  const candidateIsCanonical = declaresItselfCanonical(candidate);
  if (candidateIsCanonical !== declaresItselfCanonical(current)) return candidateIsCanonical;
  const candidateHasQuery = new URL(candidate.record.normalisedUrl).search !== '';
  if (candidateHasQuery !== (new URL(current.record.normalisedUrl).search !== '')) return !candidateHasQuery;
  const candidateHasMarkdown = candidate.markdownVariantUrl !== null;
  if (candidateHasMarkdown !== (current.markdownVariantUrl !== null)) return candidateHasMarkdown;
  const lengthDifference = candidate.record.normalisedUrl.length - current.record.normalisedUrl.length;
  if (lengthDifference !== 0) return lengthDifference < 0;
  return compareText(candidate.record.normalisedUrl, current.record.normalisedUrl) < 0;
}

function declaresItselfCanonical(page: GeneratorPage): boolean {
  const { canonicalUrl, normalisedUrl } = page.record;
  return canonicalUrl !== null && canonicalKey(canonicalUrl) === canonicalKey(normalisedUrl);
}

/**
 * The homepage's language, else the most common one. Pages that declare a different
 * primary language (`/de/...` on an English site) are locale duplicates and are left out.
 */
function primaryLanguageOf(pages: readonly GeneratorPage[]): string | null {
  const homepage = pages.find((page) => page.record.pageType === 'home' || page.crawlSignals.crawlDepth === 0);
  const homepageLanguage = primarySubtag(homepage?.record.languageCode ?? null);
  if (homepageLanguage !== null) return homepageLanguage;
  const counts = new Map<string, number>();
  for (const page of pages) {
    const language = primarySubtag(page.record.languageCode);
    if (language !== null) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  return ranked[0]?.[0] ?? null;
}

/** `guide.da.html`: the language a file name says the page is in, and the name without it. */
const LANGUAGE_FILE_NAME = /^(.+)\.([a-z]{2}(?:-[a-z]{2,4})?)(\.html?)$/i;

/**
 * In another language than the site's: by what the page declares, or by its file name
 * when the same file exists without a language or in the site's (`guide.da.html` beside
 * `guide.html`). A translation may well declare the site's language; a file name with two
 * letters in it that are not a language (`about.me.html`) has no such sibling.
 */
function isOtherLanguage(
  page: GeneratorPage,
  siteLanguage: string | null,
  pagesByUrl: ReadonlyMap<string, GeneratorPage>,
): boolean {
  if (siteLanguage === null) return false;
  const language = primarySubtag(page.record.languageCode);
  if (language !== null && language !== siteLanguage) return true;

  const url = new URL(page.record.normalisedUrl);
  const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  const fileName = LANGUAGE_FILE_NAME.exec(url.pathname.slice(directory.length));
  if (fileName === null || primarySubtag(fileName[2]!) === siteLanguage) return false;
  const [, name, , extension] = fileName;
  return [`${name}${extension}`, `${name}.${siteLanguage}${extension}`].some((sibling) =>
    pagesByUrl.has(`${url.origin}${directory}${sibling}`),
  );
}

function primarySubtag(languageCode: string | null): string | null {
  const subtag = languageCode?.split(/[-_]/)[0]?.trim().toLowerCase();
  return subtag ? subtag : null;
}
