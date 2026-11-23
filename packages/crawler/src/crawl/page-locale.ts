import { pagePathOf } from '@llms-txt/contracts';

/** Where in a URL's path a language is named, and which. */
export interface PageLocale {
  /** The path above the language's segment: pages that differ only in language share it. */
  slotKey: string;
  /** The language's primary subtag, lowercased: `pt` of `/pt-BR/`. */
  language: string;
  /** The page's URL without the language's segment: the same page where the site's main language has no segment. */
  urlWithoutLocale: string;
}

/** ISO 639-1 codes of languages that sites are translated into. Not every two letters: `/ai/`, `/go/` and `/tv/` are sections. */
const LANGUAGE_CODES = new Set(
  (
    'af ar az be bg bn bs ca cs cy da de el en es et eu fa fi fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko lt lv ' +
    'mk ml mn mr ms my nb ne nl no pa pl pt ro ru si sk sl sq sr sv sw ta te th tl tr uk ur uz vi zh'
  ).split(' '),
);
const LOCALE_SEGMENT = /^([a-z]{2})(?:[-_][a-z]{2,4})?$/i;
/** A language's segment is the first or second below the root: `/de/pricing`, `/docs/de/intro`. */
const SEGMENTS_SEARCHED_FOR_LOCALE = 2;

/**
 * The language a page's URL names in its path (`/de/pricing`, `/docs/pt-BR/intro`), or
 * null. Going by the URL alone, so it can be known before the page is fetched. Only a
 * sign: `/it/` may be a department. `isTranslation` asks for more before acting on it.
 */
export function pageLocaleOf(pageUrl: string, rootUrl: string): PageLocale | null {
  const page = new URL(pageUrl);
  const root = new URL(rootUrl);
  if (page.host !== root.host) return null;
  const segments = pagePathOf(page).split('/').filter(Boolean);
  const rootSegmentCount = pagePathOf(root).split('/').filter(Boolean).length;
  for (let index = rootSegmentCount; index < Math.min(segments.length, rootSegmentCount + SEGMENTS_SEARCHED_FOR_LOCALE); index += 1) {
    const language = LOCALE_SEGMENT.exec(segments[index]!)?.[1]?.toLowerCase();
    if (language === undefined || !LANGUAGE_CODES.has(language)) continue;
    const withoutLocale = new URL(page.href);
    withoutLocale.pathname = `/${[...segments.slice(0, index), ...segments.slice(index + 1)].join('/')}`;
    return { slotKey: segments.slice(0, index).join('/').toLowerCase(), language, urlWithoutLocale: withoutLocale.href };
  }
  return null;
}

/** A slot with this many languages holds translations even when the site's own language has no segment there. */
const LANGUAGES_THAT_MAKE_A_SLOT_OF_TRANSLATIONS = 3;

/**
 * Whether a page is a translation of one in the site's language, which a crawl does not
 * spend its budget on: an llms.txt lists a page once. The URL must name another language
 * than the site's, and the site must show that the segment is a language: the site's own
 * language is a segment in the same place (`/en/` beside `/de/`), or several languages
 * are, or the page exists without the segment (`/pricing` beside `/de/pricing`).
 */
export function isTranslation(
  locale: PageLocale | null,
  siteLanguage: string | null,
  site: { languagesAtSlot: ReadonlySet<string>; hasPage: (url: string) => boolean },
): boolean {
  if (locale === null || siteLanguage === null || locale.language === siteLanguage) return false;
  return (
    site.languagesAtSlot.has(siteLanguage) ||
    site.languagesAtSlot.size >= LANGUAGES_THAT_MAKE_A_SLOT_OF_TRANSLATIONS ||
    site.hasPage(locale.urlWithoutLocale)
  );
}
