import { pagePathOf, type GeneratorPage } from '@llms-txt/contracts';
import { titleCaseOf } from '../selection';
import type { NamingContext } from './naming-context';
import { singleLine } from '../text/normalise-text';
import { TITLE_SEPARATORS } from './title-parts';

/** A longer title is a headline or a sentence, not a name. */
const MAXIMUM_TITLE_LENGTH = 80;

/**
 * The page's title without the site name most sites add (`Docs | Acme`, `Acme | Docs`). A
 * page with no title, or titled only with the site name, gets one from the URL's last
 * path segment.
 */
export function entryTitle(page: GeneratorPage, siteTitle: string): string {
  return ownTitleOf(page, { siteTitle, homepageTitle: '', titleSuffixes: siteTitle === '' ? [] : [siteTitle] }) ?? titleFromUrl(page);
}

/**
 * The entry's title: the page's own, without the names the site's titles end with. When
 * that is missing, or is a headline or a sentence rather than a name, the text of the
 * navigation link to the page, then a title made from the URL.
 */
export function entryTitleIn(page: GeneratorPage, context: NamingContext): string {
  const ownTitle = ownTitleOf(page, context);
  if (ownTitle !== null && !looksLikeSentence(ownTitle)) return ownTitle;
  return alternativeTitlesOf(page)[0] ?? ownTitle ?? titleFromUrl(page);
}

/** What the homepage's entry is called when its title is only the site's name. */
const HOMEPAGE_ENTRY_TITLE = 'Home';

/**
 * The title of the homepage's own entry: what its title says besides the site's name
 * (`The /llms.txt file` in `The /llms.txt file – llms-txt`), and `Home` when that is
 * nothing, the site's name again, or a sentence.
 */
export function homepageEntryTitleIn(homepage: GeneratorPage, context: NamingContext): string {
  const ownTitle = ownTitleOf(homepage, { ...context, homepageTitle: '' });
  return ownTitle !== null && !looksLikeSentence(ownTitle) ? ownTitle : HOMEPAGE_ENTRY_TITLE;
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
): string | null {
  let title = singleLine(page.record.title ?? '');
  // A page on another host of the site may end its title with that host (`| docs.acme.com`).
  const names = [...context.titleSuffixes, new URL(page.record.normalisedUrl).hostname];
  // Twice, for `Page | Area | Site`.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const separator of TITLE_SEPARATORS) {
      for (const name of names) {
        const suffix = `${separator}${name}`;
        if (title.length > suffix.length && title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      }
      const prefix = `${context.siteTitle}${separator}`;
      if (context.siteTitle !== '' && title.length > prefix.length && title.startsWith(prefix)) {
        title = title.slice(prefix.length).trim();
      }
    }
  }
  const isOnlyTheSiteName = title === context.siteTitle || title === context.homepageTitle;
  return title === '' || isOnlyTheSiteName ? null : title;
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
