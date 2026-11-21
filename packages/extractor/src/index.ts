// The extractor: a pure function from HTML to a PageRecord. No I/O of any kind, so
// every behaviour is tested against saved HTML fixtures. ESLint enforces the no-I/O rule.
export { extractPage, type ExtractPageInput } from './extract-page';
