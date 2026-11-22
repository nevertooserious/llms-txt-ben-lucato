import { pagePathOf, type GeneratorPage } from '@llms-txt/contracts';
import { titleCaseOf } from '../selection';
import { areaNameOf, type NamingContext } from './naming-context';
import { normaliseForComparison, singleLine } from '../text/normalise-text';
import { withoutSiteNames, type OwnTitle } from './title-parts';

/** A longer title is a headline or a sentence, not a name. */
const MAXIMUM_TITLE_LENGTH = 80;

/**
 * The page's title without the site name most sites add (`Docs | Acme`, `Acme | Docs`). A
 * page with no title, or titled only with the site name, gets one from the URL's last
 * path segment.
 */
export function entryTitle(page: GeneratorPage, siteTitle: string): string {
  const own = ownTitleOf(page, { siteTitle, homepageTitle: '', titleSuffixes: siteTitle === '' ? [] : [siteTitle] });
  return own?.title ?? titleFromUrl(page);
}

/**
 * The entry's title: the page's own, without the names the site's titles end with, except
 * the name of its area where the title needs it (withAreaName). When the page's own title
 * is missing, or is a headline or a sentence rather than a name, the text of the
 * navigation link to the page, then a title made from the URL.
 */
export function entryTitleIn(page: GeneratorPage, context: NamingContext): string {
  const own = ownTitleOf(page, context);
  if (own !== null && !looksLikeSentence(own.title)) return withAreaName(own, context);
  return alternativeTitlesOf(page)[0] ?? own?.title ?? titleFromUrl(page);
}

/** What the homepage's entry is called when its title is only the site's name. */
const HOMEPAGE_ENTRY_TITLE = 'Home';

/**
 * The title of the homepage's own entry: what its title says besides the site's name
 * (`The /llms.txt file` in `The /llms.txt file – llms-txt`), and `Home` when that is
 * nothing, the site's name again, or a sentence.
 */
export function homepageEntryTitleIn(homepage: GeneratorPage, context: NamingContext): string {
  const own = ownTitleOf(homepage, { ...context, homepageTitle: '' });
  return own !== null && !looksLikeSentence(own.title) ? own.title : HOMEPAGE_ENTRY_TITLE;
}

/** Other names for the page, best first, for when its title is unusable or already taken. */
export function alternativeTitlesOf(page: GeneratorPage): string[] {
  const navigationLabel = singleLine(page.crawlSignals.navigationLabel ?? '');
  const lastSegment = lastPathSegmentOf(page);
  // A number or an identifier is not a name.
  const fromUrl = /\p{L}{3}/u.test(lastSegment) ? [titleFromUrl(page)] : [];
  return navigationLabel === '' ? fromUrl : [navigationLabel, ...fromUrl];
}

/** The page's title with site names removed, or null when nothing of its own is left. */
function ownTitleOf(
  page: GeneratorPage,
  context: Pick<NamingContext, 'siteTitle' | 'homepageTitle' | 'titleSuffixes'>,
): OwnTitle | null {
  const hostname = new URL(page.record.normalisedUrl).hostname;
  // A page on another host of the site may end its title with that host (`| docs.acme.com`).
  const own = withoutSiteNames(singleLine(page.record.title ?? ''), [...context.titleSuffixes, hostname], context.siteTitle);
  const isOnlyTheSiteName = own.title === context.siteTitle || own.title === context.homepageTitle;
  // A page titled with its own host has not been given a name.
  const isOnlyTheHost = own.title.toLowerCase() === hostname;
  return own.title === '' || isOnlyTheSiteName || isOnlyTheHost ? null : own;
}

/**
 * Titles that say what kind of page this is, not what it is about. On a site with several
 * sets of documentation each set has one, and only the set's name tells them apart.
 */
const GENERIC_TITLES = new Set([
  'overview', 'introduction', 'intro', 'getting started', 'get started', 'quick start', 'quickstart',
  'installation', 'install', 'setup', 'faq', 'faqs', 'frequently asked questions', 'glossary', 'reference',
  'api reference', 'guide', 'guides', 'tutorial', 'tutorials', 'examples', 'changelog', 'release notes',
  'configuration', 'usage', 'basics', 'concepts', 'troubleshooting', 'resources', 'additional resources',
  'command line interface', 'cli', 'api', 'welcome', 'about', 'documentation', 'docs', 'migration guide',
  'support', 'community', 'contributing',
]);

/**
 * The title with the name of the page's area put back (`Overview • Svelte Docs`), where
 * the site has several areas and the title alone would not say which one this page is of:
 * it is a generic title, or pages of other areas have the same one.
 */
function withAreaName(own: OwnTitle, context: NamingContext): string {
  const area = areaNameOf(own.removedEndings, context.areaNames);
  if (area === null) return own.title;
  const key = normaliseForComparison(own.title);
  const needsArea = GENERIC_TITLES.has(key) || context.titlesSharedAcrossAreas.has(key);
  return needsArea ? `${own.title}${area.separator}${area.name}` : own.title;
}

function looksLikeSentence(title: string): boolean {
  return title.length > MAXIMUM_TITLE_LENGTH || /[.!]$/.test(title);
}

function titleFromUrl(page: GeneratorPage): string {
  const words = titleCaseOf(lastPathSegmentOf(page).replace(/\.[a-z0-9]+$/i, ''));
  return words === '' ? new URL(page.record.normalisedUrl).host : words;
}

function lastPathSegmentOf(page: GeneratorPage): string {
  const lastSegment = pagePathOf(new URL(page.record.normalisedUrl)).split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}
