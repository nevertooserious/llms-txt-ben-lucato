// What the file calls things, worked out from the crawl: the site's name and each
// entry's title. A site's templates repeat the site name in every
// title, and what a page shares with the rest of the site says nothing about that page.
// So these functions look at all the pages together. Pure and deterministic.
export { buildNamingContext, type NamingContext } from './naming-context';
export { alternativeTitlesOf, entryTitle, entryTitleIn, homepageEntryTitleIn } from './entry-titles';
export { siteNameFrom } from './site-name';
