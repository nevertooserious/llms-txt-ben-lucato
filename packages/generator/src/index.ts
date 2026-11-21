// The generator: selects pages, assigns sections by page type, renders and validates.
// Pure: the worker loads its inputs, makes the LLM calls through an LlmClient, and stores
// the outputs. With no LLM configured, the summary falls back to the homepage's
// description and candidate pages are listed with what the crawl found for them.
export { entryTitle, generateLlmsTxt, siteNameFrom, type GenerateLlmsTxtInput } from './generate-llms-txt';
export {
  buildPageAssessmentPrompt,
  buildSiteSummaryInput,
  buildSiteSummaryPrompt,
  LlmOutputRejectedError,
  PAGE_ASSESSMENT_MODEL,
  pageAssessmentInputOf,
  pageAssessmentSourceHash,
  pagesToAssess,
  parsePageAssessment,
  parseSiteSummary,
  SITE_SUMMARY_MODEL,
  siteSummarySourceHash,
  type LlmClient,
  type LlmPrompt,
  type PageAssessmentInput,
  type SiteSummaryInput,
} from './llm-enrichment';
export {
  DEFAULT_SELECTION_LIMITS,
  GENERAL_SECTION_NAME,
  isPaginationUrl,
  listingCandidates,
  OPTIONAL_SECTION_NAME,
  scorePage,
  SECTION_NAMES,
  sectionNamesInOrder,
  selectPages,
  type SelectedPage,
  type SelectionLimits,
} from './select-pages';
export { ENTRY_PATTERN, validateLlmsTxt, type LlmsTxtValidationResult } from './validate-llms-txt';
export { decidePublication, listedEntries, type PageChanges, type PublicationDecision } from './decide-publication';
