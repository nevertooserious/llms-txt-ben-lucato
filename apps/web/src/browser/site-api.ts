import type { LlmsTxtVersionSummaryView, SiteView } from '@/shared/site-view';

// Browser calls to the site routes.

export class SiteApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SiteApiError';
  }
}

async function call<T>(publicSlug: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/sites/${encodeURIComponent(publicSlug)}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new SiteApiError(body.error ?? `Request failed (${response.status}).`, response.status);
  return body;
}

export const fetchSiteView = (publicSlug: string) => call<SiteView>(publicSlug, '');

export const fetchVersionSummaries = (publicSlug: string) =>
  call<LlmsTxtVersionSummaryView[]>(publicSlug, '/versions');

export const fetchVersionContent = (publicSlug: string, versionNumber: number) =>
  call<{ versionNumber: number; llmsTxtContent: string }>(publicSlug, `/versions/${versionNumber}`);

export const deleteSite = (publicSlug: string) =>
  call<Record<string, never>>(publicSlug, '', { method: 'DELETE' });

export const checkNow = (publicSlug: string) =>
  call<{ pipelineRunId: string; joinedActiveRun: boolean }>(publicSlug, '/checks', { method: 'POST' });

export const pinVersion = (publicSlug: string, versionNumber: number) =>
  call<{ versionNumber: number; isPinned: boolean }>(publicSlug, '/published-version', {
    method: 'PUT',
    body: JSON.stringify({ versionNumber }),
  });

export const followLatestVersion = (publicSlug: string) =>
  call<Record<string, never>>(publicSlug, '/published-version', { method: 'DELETE' });
