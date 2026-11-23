// Common response info for the API

export type ApiErrorCode =
  | 'cooldown_active'
  | 'demo_site_protected'
  | 'internal_error'
  | 'invalid_request'
  | 'invalid_url'
  | 'invalid_version_number'
  | 'run_in_progress'
  | 'run_not_found'
  | 'run_produced_no_version'
  | 'site_already_exists'
  | 'site_not_found'
  | 'unauthorized'
  | 'version_not_found';

/** `error` is for front-end info; `code` is for business logic. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  headers?: Record<string, string>,
  details?: Record<string, string>,
): Response {
  return Response.json({ error: message, code, ...details }, { status, headers });
}

export const siteApiPath = (publicSlug: string) => `/api/sites/${encodeURIComponent(publicSlug)}`;
export const runApiPath = (publicSlug: string, pipelineRunId: string) =>
  `${siteApiPath(publicSlug)}/runs/${pipelineRunId}`;
export const hostedLlmsTxtPath = (publicSlug: string) => `/w/${encodeURIComponent(publicSlug)}/llms.txt`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPipelineRunId = (text: string) => UUID_PATTERN.test(text);

export function llmsTxtFileResponse(file: { versionNumber: number; llmsTxtContent: string }): Response {
  return new Response(file.llmsTxtContent, {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-llms-txt-version': String(file.versionNumber),
      'x-content-type-options': 'nosniff',
    },
  });
}
