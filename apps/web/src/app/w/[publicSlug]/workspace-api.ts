import type { WorkspaceView } from '../../../shared/workspace-view';

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

export const setMonitoring = (publicSlug: string, accessToken: string, enabled: boolean) =>
  call<{ monitoringEnabledUntil: string | null }>(publicSlug, accessToken, '/monitoring', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });

export const checkNow = (publicSlug: string, accessToken: string) =>
  call<{ pipelineRunId: string; joinedActiveRun: boolean }>(publicSlug, accessToken, '/checks', { method: 'POST' });
