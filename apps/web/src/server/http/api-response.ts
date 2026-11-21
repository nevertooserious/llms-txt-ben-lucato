// Common response info for the API

export type ApiErrorCode =
  | 'cooldown_active'
  | 'internal_error'
  | 'invalid_request'
  | 'invalid_url'
  | 'invalid_version_number'
  | 'rate_limited'
  | 'run_in_progress'
  | 'run_not_found'
  | 'run_produced_no_version'
  | 'site_not_found'
  | 'unauthorized'
  | 'version_not_found';

/** `error` is for front-end info; `code` is for business logic. */
export function apiError(status: number, code: ApiErrorCode, message: string, headers?: Record<string, string>): Response {
  return Response.json({ error: message, code }, { status, headers });
}

export const siteApiPath = (publicSlug: string) => `/api/sites/${encodeURIComponent(publicSlug)}`;
export const runApiPath = (publicSlug: string, pipelineRunId: string) =>
  `${siteApiPath(publicSlug)}/runs/${pipelineRunId}`;
export const hostedLlmsTxtPath = (publicSlug: string) => `/w/${encodeURIComponent(publicSlug)}/llms.txt`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPipelineRunId = (text: string) => UUID_PATTERN.test(text);

// TODO blucato
export function llmsTxtFileResponse(
  request: Request,
  file: { versionNumber: number; llmsTxtContent: string; llmsTxtContentHash: string },
): Response {
  const etag = `"${file.llmsTxtContentHash}"`;
  const headers = {
    etag,
    'cache-control': 'no-cache',
    'x-llms-txt-version': String(file.versionNumber),
    'x-content-type-options': 'nosniff',
  };
  const presented = (request.headers.get('if-none-match') ?? '').split(',').map((tag) => tag.trim().replace(/^W\//, ''));
  if (presented.includes(etag) || presented.includes('*')) return new Response(null, { status: 304, headers });
  return new Response(file.llmsTxtContent, {
    status: 200,
    headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
  });
}
