// The words of the file that come from the crawl rather than from an LLM or a user: the
// site's name and each entry's title. A site's templates repeat the site name in every
// title, and what a page shares with the rest of the site says nothing about that page.
// So these functions look at all the pages together. Pure and deterministic.
export { buildEntryTextContext, type EntryTextContext } from './entry-text-context';
export { alternativeTitlesOf, entryTitle, entryTitleIn } from './entry-titles';
export { siteNameFrom } from './site-name';
export { normaliseForComparison, singleLine, truncate } from './text';
