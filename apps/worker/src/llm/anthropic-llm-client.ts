import Anthropic from '@anthropic-ai/sdk';
import {
  buildPageAssessmentPrompt,
  buildSiteSummaryPrompt,
  LlmOutputRejectedError,
  PAGE_ASSESSMENT_MODEL,
  parsePageAssessment,
  parseSiteSummary,
  SITE_SUMMARY_MODEL,
  type LlmClient,
} from '@llms-txt/generator';

// The generator's LLM calls, made through the Anthropic SDK. The SDK retries rate limits,
// server errors and dropped connections itself.

const REQUEST_TIMEOUT_MS = 120_000;
const PAGE_ASSESSMENT_MAX_TOKENS = 2_000;
const SITE_SUMMARY_MAX_TOKENS = 6_000;

/** The part of a response this client reads. */
interface LlmResponse {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** The text of a finished answer. A refusal or a cut-off answer is not one. */
export function answerText(response: LlmResponse): string {
  if (response.stop_reason !== 'end_turn') {
    throw new LlmOutputRejectedError(`the model stopped with ${response.stop_reason ?? 'no reason'}`);
  }
  return response.content.flatMap((block) => (block.type === 'text' && block.text ? [block.text] : [])).join('');
}

export function createAnthropicLlmClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  return {
    async assessPage(input) {
      const prompt = buildPageAssessmentPrompt(input);
      const response = await client.messages.create({
        model: PAGE_ASSESSMENT_MODEL,
        max_tokens: PAGE_ASSESSMENT_MAX_TOKENS,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: prompt.outputSchema } },
      });
      return parsePageAssessment(answerText(response));
    },
    async writeSiteSummary(input) {
      const prompt = buildSiteSummaryPrompt(input);
      const response = await client.beta.messages.create({
        model: SITE_SUMMARY_MODEL,
        max_tokens: SITE_SUMMARY_MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: prompt.outputSchema } },
      });
      return parseSiteSummary(answerText(response));
    },
  };
}
