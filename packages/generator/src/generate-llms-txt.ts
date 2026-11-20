import {
  NotImplementedError,
  type GeneratorPage,
  type WorkspacePageOverride,
} from '@llms-txt/contracts';

/** The only LLM calls the generator makes. Results are cached by the caller. */
export interface LlmClient {
  writeSiteSummary(input: { siteTitle: string; pages: GeneratorPage[] }): Promise<string>;
  writePageDescription(input: { title: string; contentMarkdown: string }): Promise<string>;
}

export interface GenerateLlmsTxtInput {
  siteTitle: string;
  /** Cached site summary; written by the LLM only when its inputs change. */
  siteSummary: string | null;
  pages: GeneratorPage[];
  overrides: WorkspacePageOverride[];
}

/** Deterministic: the same input always renders the same text. */
export function generateLlmsTxt(input: GenerateLlmsTxtInput): string {
  void input;
  throw new NotImplementedError('generateLlmsTxt');
}
