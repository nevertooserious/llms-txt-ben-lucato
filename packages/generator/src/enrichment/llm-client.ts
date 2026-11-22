import type { PageAssessment } from '@llms-txt/contracts';

// What the generator asks an LLM, and what it accepts back. Pure: the worker makes the
// calls through an LlmClient and stores the results. Each result is cached against a
// hash of its inputs, because an LLM words the same thing differently each time.

export const PAGE_ASSESSMENT_MODEL = 'claude-haiku-5-5';

/** The model's answer to "would this page help an AI assistant?". Code maps it to a listing value. */
export const ASSISTANT_VALUES = ['high', 'some', 'none'] as const;
export type AssistantValue = (typeof ASSISTANT_VALUES)[number];
export const SITE_SUMMARY_MODEL = 'claude-opus-5-5';

/** Notes are for the few things the links cannot say, so the file stays an index. */
export const MAXIMUM_SITE_NOTES = 5;

/** The model declined, or returned something unusable. Asking again now would not help. */
export class LlmOutputRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmOutputRejectedError';
  }
}

export interface PageAssessmentInput {
  url: string;
  title: string | null;
  metaDescription: string | null;
  urlBasedPageType: string;
  contentMarkdown: string;
}

export interface SiteSummaryInput {
  siteTitle: string;
  homepageDescription: string | null;
  homepageContentMarkdown: string;
  listedPages: Array<{ title: string; description: string | null; sectionName: string }>;
  /** Kept unless it is now wrong, so a real change gives a small diff. */
  previousSummary: string | null;
  previousNotes: string[];
}

/** What the LLM writes for the top of the file. */
export interface GeneratedSiteSummary {
  summary: string;
  /** One line each, under the summary. Empty for most sites. */
  notes: string[];
}

/** The LLM calls the generator needs. Throws LlmOutputRejectedError for an unusable answer. */
export interface LlmClient {
  assessPage(input: PageAssessmentInput): Promise<PageAssessment>;
  writeSiteSummary(input: SiteSummaryInput): Promise<GeneratedSiteSummary>;
}

export interface LlmPrompt {
  system: string;
  user: string;
  outputSchema: Record<string, unknown>;
}
