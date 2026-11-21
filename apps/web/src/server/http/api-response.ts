// What the REST API's route handlers have in common: errors with a stable code, the
// paths it links to, and the plain-text form of an llms.txt.

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
  | 'version_not_found';

/** `error` is for people and may be reworded; `code` is for programs and will not be. */
export function apiError(status: number, code: ApiErrorCode, message: string, headers?: Record<string, string>): Response {
  return Response.json({ error: message, code }, { status, headers });
}

export const siteApiPath = (publicSlug: string) => `/api/sites/${encodeURIComponent(publicSlug)}`;
export const runApiPath = (publicSlug: string, pipelineRunId: string) =>
  `${siteApiPath(publicSlug)}/runs/${pipelineRunId}`;
export const hostedLlmsTxtPath = (publicSlug: string) => `/w/${encodeURIComponent(publicSlug)}/llms.txt`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checked before a query, because Postgres raises an error on a malformed uuid. */
export const isPipelineRunId = (text: string) => UUID_PATTERN.test(text);

/** One version's file as text/plain. Its ETag is the content hash, so a client can revalidate. */
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
