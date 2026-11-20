import type { PageType } from '@llms-txt/contracts';

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
 * Classifies a page from its URL first: the first path segment (or subdomain, as in
 * docs.example.com) that names a section decides, and a docs section is narrowed by a
 * later api or guide segment. Locale prefixes such as /en/ match nothing and are
 * skipped. Only when the URL says nothing do og:type and JSON-LD types count.
 */
export function classifyPageType(signals: PageTypeSignals): PageType {
  if (signals.isHomepage) return 'home';

  const segmentTypes = urlSegments(signals.url).flatMap((segment) => {
    const match = SEGMENT_PATTERNS.find(([, pattern]) => pattern.test(segment));
    return match ? [match[0]] : [];
  });
  const [firstType, ...laterTypes] = segmentTypes;
  if (firstType === 'docs') return laterTypes.find((type) => DOCS_REFINEMENTS.has(type)) ?? 'docs';
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

/** Leading subdomain labels (not www) followed by the path segments, lowercased. */
function urlSegments(url: string): string[] {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return [];
  }
  const hostLabels = parsedUrl.hostname.toLowerCase().split('.');
  const subdomainLabels = hostLabels.slice(0, -2).filter((label) => label !== 'www');
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
