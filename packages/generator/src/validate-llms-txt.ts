import { NotImplementedError } from '@llms-txt/contracts';

export interface LlmsTxtValidationResult {
  isValid: boolean;
  problems: string[];
}

/**
 * Checks the rules in docs/design/README.md section 8: one H1 first, an optional
 * blockquote, only H1 and H2, one-line `- [title](url): description` entries, and an
 * H2 named exactly `Optional` for skippable links.
 */
export function validateLlmsTxt(llmsTxt: string): LlmsTxtValidationResult {
  void llmsTxt;
  throw new NotImplementedError('validateLlmsTxt');
}
