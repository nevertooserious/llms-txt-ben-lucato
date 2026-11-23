import type { CheerioAPI } from 'cheerio/slim';
import type { PageRecord } from '@llms-txt/contracts';
import { classifyPageType } from './record/classify-page-type';
import { computeContentDigest, computeListingFieldsHash } from './record/compute-hashes';
import { convertToMarkdown } from './record/convert-to-markdown';
import { collapseWhitespace, documentBaseUrl, nonEmptyText, parseHtml, resolveUrl } from './html/parse-html';
import { removeNonContent, selectMainContent } from './html/select-main-content';

export interface ExtractPageInput {
  /** Raw response body or headless-rendered DOM; the extractor does not care which. */
  html: string;
  normalisedUrl: string;
  /** Where the page ended up after redirects; relative links resolve against it. */
  finalUrl: string;
  isHomepage: boolean;
}

/** A first paragraph shorter than this is a byline or caption, not a description. */
const MINIMUM_PARAGRAPH_DESCRIPTION_LENGTH = 50;
/** First-paragraph descriptions are cut to this length at a word boundary. */
const MAXIMUM_PARAGRAPH_DESCRIPTION_LENGTH = 300;
/** What sites put between a page's name and the site's name in <title>. */
const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' · ', ' • ', ' » ', ' :: '];

/** A declared site name longer than this is a tagline or a mistake, not a name. */
const MAXIMUM_SITE_NAME_LENGTH = 60;

/**
 * Meta names are matched whatever their case (`<META NAME="Description">`).
 * Title: on an inner page whose <title> is a page name plus the site name the page
 * declares (`Downloads | Acme` with og:site_name `Acme`), that page name. Otherwise the
 * Open Graph title, then <title>, then the first <h1>; and on an inner page whose Open
 * Graph title is only the site name its <title> ends with, the first <h1>, then <title>.
 * A title that is only the page's file name (`domains` at `/domains.html`) gives way to
 * the first <h1>: a site generator wrote it, not an author.
 * Site name: og:site_name, then a JSON-LD WebSite name, then application-name.
 * Description: meta description, then Open Graph description, then the first
 * paragraph of the main content.
 * Content: see selectMainContent; converted to markdown.
 */
export function extractPage(input: ExtractPageInput): PageRecord {
  const $ = parseHtml(input.html);
  const baseUrl = documentBaseUrl($, input.finalUrl);

  // Metadata is read before content selection, which removes elements.
  const declaredSiteName = readDeclaredSiteName($);
  const title = chooseTitle(readTitleSources($), declaredSiteName, input);
  const metadataDescription =
    metaContent($, 'meta[name="description" i]') ?? metaContent($, 'meta[property="og:description"]');
  const canonicalHref = $('link[rel~="canonical"][href]').first().attr('href');
  const canonicalUrl = canonicalHref ? resolveUrl(canonicalHref, baseUrl) : null;
  const languageCode = nonEmptyText($('html').attr('lang'))?.toLowerCase() ?? null;
  const pageType = classifyPageType({
    url: input.normalisedUrl,
    isHomepage: input.isHomepage,
    openGraphType: metaContent($, 'meta[property="og:type"]')?.toLowerCase() ?? null,
    structuredDataTypes: structuredDataTypes($),
  });

  removeNonContent($);
  const content = selectMainContent($);
  const description = metadataDescription ?? firstParagraphDescription($, content);
  const contentDigest = computeContentDigest(content.text());
  const contentMarkdown = convertToMarkdown($, content, baseUrl);

  return {
    normalisedUrl: input.normalisedUrl,
    canonicalUrl,
    title,
    description,
    declaredSiteName,
    pageType,
    languageCode,
    contentMarkdown,
    contentDigest,
    listingFieldsHash: computeListingFieldsHash({ title, description, contentDigest }),
  };
}

/** The texts a page's title can come from. */
interface TitleSources {
  /** The first <h1>, without its permalink anchor. */
  heading: string | null;
  openGraphTitle: string | null;
  titleTag: string | null;
}

function readTitleSources($: CheerioAPI): TitleSources {
  const { heading, headingWithAnchor } = firstHeading($);
  const openGraphTitle = withoutHeadingAnchor(metaContent($, 'meta[property="og:title"]'), heading, headingWithAnchor);
  // An inline <svg>'s <title> names an icon, not the page.
  // <title> holds text only, so markup written inside it arrives as text and is taken out.
  const titleText = $('title').not('svg title').first().text().replace(/<\/?[a-z][^>]*>/gi, '');
  const titleTag = withoutHeadingAnchor(nonEmptyText(titleText), heading, headingWithAnchor);
  return { heading, openGraphTitle, titleTag };
}

function readDeclaredSiteName($: CheerioAPI): string | null {
  return siteNameOrNull(
    metaContent($, 'meta[property="og:site_name"]') ??
      structuredDataWebSiteName($) ??
      metaContent($, 'meta[name="application-name" i]'),
  );
}

/** The title, by the rules on extractPage. */
function chooseTitle(sources: TitleSources, declaredSiteName: string | null, input: ExtractPageInput): string | null {
  const declaredTitle = input.isHomepage
    ? (sources.openGraphTitle ?? sources.titleTag ?? sources.heading)
    : innerPageTitle(sources, declaredSiteName);
  if (declaredTitle === null || !isFileNameOf(declaredTitle, input.normalisedUrl)) return declaredTitle;
  return sources.heading ?? declaredTitle;
}

function innerPageTitle({ heading, openGraphTitle, titleTag }: TitleSources, declaredSiteName: string | null): string | null {
  if (titleTag === null) return openGraphTitle ?? heading;
  const pageNameInTitleTag = declaredSiteName === null ? null : withoutSiteName(titleTag, declaredSiteName);
  if (pageNameInTitleTag !== null) return pageNameInTitleTag;
  if (openGraphTitle !== null && isSiteNameOf(openGraphTitle, titleTag)) return heading ?? titleTag;
  return openGraphTitle ?? titleTag;
}

function metaContent($: CheerioAPI, selector: string): string | null {
  return nonEmptyText($(selector).first().attr('content'));
}

/**
 * Whether <title> is a page name followed by this text: `Changes – Acme`. A <title>
 * that starts with the Open Graph title (`Changes – Acme` again, with og:title
 * `Changes`) is the usual case of a page naming itself, so only the end counts.
 */
function isSiteNameOf(openGraphTitle: string, titleTag: string): boolean {
  return TITLE_SEPARATORS.some((separator) => titleTag.endsWith(`${separator}${openGraphTitle}`));
}

/** Whether the title is exactly the URL's last path segment, less any extension: `domains` for `/guide/domains.html`. */
function isFileNameOf(title: string, url: string): boolean {
  const lastSegment = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  let fileName = lastSegment.replace(/\.[a-z0-9]+$/i, '');
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // Kept as written.
  }
  return fileName !== '' && title === fileName;
}

/** The page name in `Page | Site` or `Site | Page`, or null when the title is not that. */
function withoutSiteName(titleTag: string, siteName: string): string | null {
  for (const separator of TITLE_SEPARATORS) {
    const suffix = `${separator}${siteName}`;
    if (titleTag.length > suffix.length && titleTag.endsWith(suffix)) return nonEmptyText(titleTag.slice(0, -suffix.length));
    const prefix = `${siteName}${separator}`;
    if (titleTag.length > prefix.length && titleTag.startsWith(prefix)) return nonEmptyText(titleTag.slice(prefix.length));
  }
  return null;
}

function siteNameOrNull(text: string | null): string | null {
  return text !== null && text.length <= MAXIMUM_SITE_NAME_LENGTH ? text : null;
}

/**
 * The first <h1> with text, without the permalink anchor documentation tools add
 * (`Title¶`, or an icon font's `Titlelink`), and the same heading with the anchor's text.
 * A `#` counts as an anchor only when it is a link of its own: `C#` is a name.
 */
function firstHeading($: CheerioAPI): { heading: string | null; headingWithAnchor: string | null } {
  for (const element of $('h1').toArray()) {
    const withoutAnchor = $(element).clone();
    withoutAnchor.find('a.headerlink, a.header-anchor, a.header-link, a.anchor, a.hash-link, a[aria-hidden="true"]').remove();
    withoutAnchor
      .find('a')
      .filter((_, link) => /^[¶#§]$/.test($(link).text().trim()))
      .remove();
    const heading = nonEmptyText(withoutAnchor.text().replace(/[¶§]\s*$/, ''));
    if (heading !== null) return { heading, headingWithAnchor: nonEmptyText($(element).text()) };
  }
  return { heading: null, headingWithAnchor: null };
}

/** A site that builds its titles from its heading's text copies the anchor too (`Acme - Setuplink`). */
function withoutHeadingAnchor(title: string | null, heading: string | null, headingWithAnchor: string | null): string | null {
  if (title === null || heading === null || headingWithAnchor === null || heading === headingWithAnchor) return title;
  return title.endsWith(headingWithAnchor) ? `${title.slice(0, -headingWithAnchor.length)}${heading}` : title;
}

function firstParagraphDescription($: CheerioAPI, content: ReturnType<typeof selectMainContent>): string | null {
  const paragraph = content
    .find('p')
    .toArray()
    .map((element) => collapseWhitespace($(element).text()))
    .find((text) => text.length >= MINIMUM_PARAGRAPH_DESCRIPTION_LENGTH);
  return paragraph === undefined ? null : truncateAtWord(paragraph, MAXIMUM_PARAGRAPH_DESCRIPTION_LENGTH);
}

function truncateAtWord(text: string, maximumLength: number): string {
  if (text.length <= maximumLength) return text;
  const cut = text.slice(0, maximumLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** Every @type in the page's JSON-LD blocks, including inside @graph. Bad JSON is skipped. */
function structuredDataTypes($: CheerioAPI): string[] {
  return structuredDataNodes($).flatMap((node) => typesOf(node));
}

/** The name of the first JSON-LD node typed WebSite. */
function structuredDataWebSiteName($: CheerioAPI): string | null {
  for (const node of structuredDataNodes($)) {
    if (!typesOf(node).some((type) => type.toLowerCase() === 'website')) continue;
    const name = typeof node.name === 'string' ? nonEmptyText(node.name) : null;
    if (name !== null) return name;
  }
  return null;
}

function typesOf(node: Record<string, unknown>): string[] {
  const nodeType = node['@type'];
  if (typeof nodeType === 'string') return [nodeType];
  return Array.isArray(nodeType) ? nodeType.filter((type): type is string => typeof type === 'string') : [];
}

/** Every node in the page's JSON-LD blocks, including inside @graph. */
function structuredDataNodes($: CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value !== null && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      nodes.push(node);
      collect(node['@graph']);
    }
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      collect(JSON.parse($(element).text()));
    } catch {
      // Malformed JSON-LD is common and says nothing reliable.
    }
  });
  return nodes;
}
