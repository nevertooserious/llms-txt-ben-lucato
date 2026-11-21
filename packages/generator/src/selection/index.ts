// Which pages are listed, and where. Sections come from page type and, for pages of no
// particular type, from the area of the site they sit in; the LLM never chooses them.
// Pure and deterministic: ties are broken by URL.
export { excludePagesUnderUrlPrefixes } from './excluded-url-prefixes';
export { listingCandidates } from './listing-candidates';
export { homepageOf } from './page-kinds';
export { scorePage } from './score-page';
export { GENERAL_SECTION_NAME, OPTIONAL_SECTION_NAME, SECTION_NAMES, sectionNamesInOrder } from './sections';
export { selectPages, type SelectedPage } from './select-pages';
export { DEFAULT_SELECTION_LIMITS, type SelectionLimits } from './selection-limits';
export { compareText, isPaginationUrl, pathSegmentsOf, titleCaseOf } from './url-paths';
