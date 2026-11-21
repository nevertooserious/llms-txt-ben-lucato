import type { CheerioAPI } from 'cheerio/slim';
import type { PageRecord } from '@llms-txt/contracts';
import { classifyPageType } from './classify-page-type';
import { computeContentDigest, computeListingFieldsHash } from './compute-hashes';
import { convertToMarkdown } from './convert-to-markdown';
import { collapseWhitespace, documentBaseUrl, nonEmptyText, parseHtml, resolveUrl } from './parse-html';
import { removeNonContent, selectMainContent } from './select-main-content';

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
const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' · ', ' :: '];

/**
 * Title: Open Graph title, then <title>, then the first <h1>. On an inner page whose
 * Open Graph title is only the site name, the first <h1>, then <title>.
 * Description: meta description, then Open Graph description, then the first
 * paragraph of the main content.
 * Content: see selectMainContent; converted to markdown.
 */
export function extractPage(input: ExtractPageInput): PageRecord {
  const $ = parseHtml(input.html);
  const baseUrl = documentBaseUrl($, input.finalUrl);

  // Metadata is read before content selection, which removes elements.
  const openGraphTitle = metaContent($, 'meta[property="og:title"]');
  const titleTag = nonEmptyText($('title').first().text());
  const heading = firstHeading($);
  const title =
    !input.isHomepage && openGraphTitle !== null && titleTag !== null && isSiteNameOf(openGraphTitle, titleTag)
      ? (heading ?? titleTag)
      : (openGraphTitle ?? titleTag ?? heading);
  const metadataDescription =
    metaContent($, 'meta[name="description"]') ?? metaContent($, 'meta[property="og:description"]');
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
    pageType,
    languageCode,
    contentMarkdown,
    contentDigest,
    listingFieldsHash: computeListingFieldsHash({ title, description, contentDigest }),
  };
}

function metaContent($: CheerioAPI, selector: string): string | null {
  return nonEmptyText($(selector).first().attr('content'));
}

/** Whether <title> is this text plus a page name: `Changes – Acme` or `Acme | Changes`. */
function isSiteNameOf(openGraphTitle: string, titleTag: string): boolean {
  return TITLE_SEPARATORS.some(
    (separator) =>
      titleTag.endsWith(`${separator}${openGraphTitle}`) || titleTag.startsWith(`${openGraphTitle}${separator}`),
  );
}

function firstHeading($: CheerioAPI): string | null {
  const heading = $('h1')
    .toArray()
    .map((element) => nonEmptyText($(element).text()))
    .find((text) => text !== null);
  return heading ?? null;
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
  const types: string[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value !== null && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      const nodeType = node['@type'];
      if (typeof nodeType === 'string') types.push(nodeType);
      if (Array.isArray(nodeType)) types.push(...nodeType.filter((type) => typeof type === 'string'));
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
  return types;
}
