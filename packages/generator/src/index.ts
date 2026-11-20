// The generator: selects pages, assigns sections by page type, asks the LLM only for
// what is missing (cached against a hash of its inputs), renders and validates.
export { generateLlmsTxt, type GenerateLlmsTxtInput, type LlmClient } from './generate-llms-txt';
export { validateLlmsTxt, type LlmsTxtValidationResult } from './validate-llms-txt';
