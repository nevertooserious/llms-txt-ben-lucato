// The generator: selects pages, assigns sections by page type, renders and validates.
// Pure: the worker loads its inputs, makes the LLM calls through an LlmClient, and stores
// the outputs. With no LLM configured, the summary falls back to the homepage's
// description, there are no notes, and candidate pages are listed with what the crawl found for them.
export { siteNameFrom } from './entry-text';
export { generateLlmsTxt, type GenerateLlmsTxtInput } from './rendering/generate-llms-txt';
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
  type GeneratedSiteSummary,
  type LlmClient,
  type LlmPrompt,
  type PageAssessmentInput,
  type SiteSummaryInput,
} from './enrichment';
export {
  DEFAULT_SELECTION_LIMITS,
  excludePagesUnderUrlPrefixes,
  listingCandidates,
  selectPages,
  type SelectedPage,
  type SelectionLimits,
} from './selection';
export { validateLlmsTxt, type LlmsTxtValidationResult } from './rendering/validate-llms-txt';
export { decidePublication, listedEntries, NOTHING_TO_LIST_REASON, type PageChanges, type PublicationDecision } from './publication/decide-publication';
