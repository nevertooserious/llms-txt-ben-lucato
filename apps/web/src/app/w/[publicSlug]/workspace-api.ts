import type { SaveExclusionsResult, WorkspaceExclusions, WorkspacePagesView } from '../../../shared/workspace-pages';
import type { LlmsTxtVersionSummaryView, WorkspaceView } from '../../../shared/workspace-view';

// Browser calls to the workspace routes, authorised with the secret link's token.

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WorkspaceApiError';
  }
}

async function call<T>(publicSlug: string, accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(publicSlug)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new WorkspaceApiError(body.error ?? `Request failed (${response.status}).`, response.status);
  return body;
}

export const fetchWorkspaceView = (publicSlug: string, accessToken: string) =>
  call<WorkspaceView>(publicSlug, accessToken, '');

export const fetchVersionSummaries = (publicSlug: string, accessToken: string) =>
  call<LlmsTxtVersionSummaryView[]>(publicSlug, accessToken, '/versions');

export const fetchVersionContent = (publicSlug: string, accessToken: string, versionNumber: number) =>
  call<{ versionNumber: number; llmsTxtContent: string }>(publicSlug, accessToken, `/versions/${versionNumber}`);

export const deleteWorkspace =(publicSlug: string, accessToken: string) =>
  call<Record<string, never>>(publicSlug, accessToken, '', { method: 'DELETE' });

export const checkNow = (publicSlug: string, accessToken: string) =>
  call<{ pipelineRunId: string; joinedActiveRun: boolean }>(publicSlug, accessToken, '/checks', { method: 'POST' });

export const pinVersion = (publicSlug: string, accessToken: string, versionNumber: number) =>
  call<{ versionNumber: number; isPinned: boolean }>(publicSlug, accessToken, '/published-version', {
    method: 'PUT',
    body: JSON.stringify({ versionNumber }),
  });

export const followLatestVersion = (publicSlug: string, accessToken: string) =>
  call<Record<string, never>>(publicSlug, accessToken, '/published-version', { method: 'DELETE' });

export const fetchWorkspacePages = (publicSlug: string, accessToken: string) =>
  call<WorkspacePagesView>(publicSlug, accessToken, '/pages');

export const saveWorkspaceExclusions = (publicSlug: string, accessToken: string, exclusions: WorkspaceExclusions) =>
  call<SaveExclusionsResult>(publicSlug, accessToken, '/pages', { method: 'PUT', body: JSON.stringify(exclusions) });
