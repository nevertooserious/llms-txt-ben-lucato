// The generator: selects pages, assigns sections by page type, renders and validates.
// Pure: the worker loads its inputs, makes the LLM calls through an LlmClient, and stores
// the outputs. Only assessed pages are listed. A site with no summary yet falls back to
// the homepage's description.
export { siteNameFrom } from './naming';
export { generateLlmsTxt, type GenerateLlmsTxtInput } from './rendering/generate-llms-txt';
export {
  buildPageAssessmentPrompt,
  buildSiteSummaryInput,
  siteNameIfOnSite,
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
  excludePagesUnderUrlPrefixes,
  listingCandidates,
  selectPages,
  type SelectedPage,
} from './selection';
export { validateLlmsTxt, type LlmsTxtValidationResult } from './rendering/validate-llms-txt';
export { decidePublication, listedEntries, NOTHING_TO_LIST_REASON, type PageChanges, type PublicationDecision } from './publication/decide-publication';
