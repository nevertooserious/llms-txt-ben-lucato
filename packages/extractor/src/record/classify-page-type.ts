import type { PageType } from '@llms-txt/contracts';
import { getSubdomain } from 'tldts';

export interface PageTypeSignals {
  url: string;
  isHomepage: boolean;
  /** The og:type meta value, lowercased. */
  openGraphType: string | null;
  /** Every schema.org @type in the page's JSON-LD. */
  structuredDataTypes: string[];
}

type ClassifiedPageType = Exclude<PageType, 'home' | 'other'>;

/** Whole path segments (and leading subdomain labels) that name a section of a site. */
const SEGMENT_PATTERNS: [ClassifiedPageType, RegExp][] = [
  [
    'legal',
    /^(?:legal|privacy|privacy-policy|terms|terms-of-service|terms-of-use|terms-and-conditions|tos|cookies?|cookie-policy|gdpr|imprint|impressum|dpa|acceptable-use(?:-policy)?|licen[cs]e|licensing|disclaimer|polic(?:y|ies))$/,
  ],
  ['pricing', /^(?:pricing|plans|plans-and-pricing|prices)$/],
  ['blog', /^(?:blogs?|news|posts?|articles?|stories|press|newsroom|changelog|updates|insights)$/],
  ['api', /^(?:apis?|api-reference|api-docs|reference|references|rest-api|graphql|sdks?|endpoints)$/],
  [
    'guide',
    /^(?:guides?|tutorials?|getting-started|get-started|quickstart|quick-start|learn|how-to|howto|cookbook|examples|walkthroughs?)$/,
  ],
  ['docs', /^(?:docs?|documentation|manual|handbook|help|support|kb|knowledge-base|faqs?|wiki|developers?|dev)$/],
  ['about', /^(?:about|about-us|company|team|careers|jobs|contact|contact-us|mission|our-story|leadership)$/],
  ['product', /^(?:products?|features?|solutions?|platform|integrations?|use-cases|enterprise|customers)$/],
];

/** A docs section can be narrowed by a later segment: /docs/api/... is API reference. */
const DOCS_REFINEMENTS: ReadonlySet<PageType> = new Set(['api', 'guide']);

/**
 * Names a docs section only at the top of the site. Deeper down they are one area's own
 * page (`/foundation/faq`, `/store/help`), not the site's documentation.
 */
const TOP_LEVEL_ONLY_DOCS_SEGMENT = /^(?:help|support|faqs?)$/;
/** Sections whose pages may be about legal subjects without being legal pages (`/docs/cookies`). */
const WRITING_ABOUT_ANYTHING: ReadonlySet<PageType> = new Set(['docs', 'api', 'guide', 'blog']);
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/;

/**
 * Classifies a page from its URL first: the first path segment (or subdomain, as in
 * docs.example.com) that names a section decides. A docs section is narrowed by a later
 * api or guide segment, and a later legal segment makes a legal page (`/about/legal`)
 * outside documentation and blogs, which write about anything. Locale prefixes such as /en/ match nothing and are
 * skipped. Only when the URL says nothing do og:type and JSON-LD types count.
 */
export function classifyPageType(signals: PageTypeSignals): PageType {
  if (signals.isHomepage) return 'home';

  const segments = urlSegments(signals.url);
  const segmentTypes = segments.flatMap((segment, index) => {
    const match = SEGMENT_PATTERNS.find(([, pattern]) => pattern.test(segment));
    if (!match) return [];
    const isBelowTopLevel = segments.slice(0, index).some((earlier) => !LOCALE_SEGMENT.test(earlier));
    if (match[0] === 'docs' && TOP_LEVEL_ONLY_DOCS_SEGMENT.test(segment) && isBelowTopLevel) return [];
    return [match[0]];
  });
  const [firstType, ...laterTypes] = segmentTypes;
  if (firstType === 'docs') return laterTypes.find((type) => DOCS_REFINEMENTS.has(type)) ?? 'docs';
  if (firstType && !WRITING_ABOUT_ANYTHING.has(firstType) && laterTypes.includes('legal')) return 'legal';
  if (firstType) return firstType;

  return classifyFromMetadata(signals) ?? 'other';
}

function classifyFromMetadata(signals: PageTypeSignals): PageType | null {
  const types = new Set(signals.structuredDataTypes.map((type) => type.toLowerCase()));
  if (types.has('apireference')) return 'api';
  if (types.has('techarticle')) return 'docs';
  if (types.has('product')) return 'product';
  if (['blogposting', 'newsarticle', 'article'].some((type) => types.has(type))) return 'blog';
  if (signals.openGraphType === 'article') return 'blog';
  return null;
}

/**
 * Leading subdomain labels (not www) followed by the path segments, lowercased. The public
 * suffix list says where the site's own domain starts: `example` in example.co.uk and
 * `acme` in acme.github.io are the site's name, not a subdomain.
 */
function urlSegments(url: string): string[] {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return [];
  }
  const subdomain = getSubdomain(parsedUrl.hostname, { allowPrivateDomains: true }) ?? '';
  const subdomainLabels = subdomain.split('.').filter((label) => label !== '' && label !== 'www');
  const pathSegments = parsedUrl.pathname
    .split('/')
    .map((segment) => safeDecode(segment).toLowerCase().replace(/\.(?:html?|php|aspx?)$/, ''))
    .filter((segment) => segment !== '');
  return [...subdomainLabels, ...pathSegments];
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
