// The generator: selects pages, assigns sections by page type, renders and validates.
// Pure: the worker loads its inputs and stores its outputs. LLM calls (site summary,
// missing descriptions) are not wired in yet; without them the summary falls back to
// the homepage's description and pages without a description are listed without one.
export { entryTitle, generateLlmsTxt, type GenerateLlmsTxtInput, type LlmClient } from './generate-llms-txt';
export {
  DEFAULT_SELECTION_LIMITS,
  isPaginationUrl,
  OPTIONAL_SECTION_NAME,
  scorePage,
  SECTION_NAMES,
  selectPages,
  type SelectedPage,
  type SelectionLimits,
} from './select-pages';
export { ENTRY_PATTERN, validateLlmsTxt, type LlmsTxtValidationResult } from './validate-llms-txt';
export { decidePublication, listedEntries, type PageChanges, type PublicationDecision } from './decide-publication';
