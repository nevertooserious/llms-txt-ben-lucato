import { createHash, timingSafeEqual } from 'node:crypto';
import { loadWorkspaceAccess, type Queryable, type WorkspaceAccess } from '@llms-txt/db';

// There are no accounts: holding a workspace's secret link authorises changing it
// (docs/design/README.md, section 3). The browser sends the link's token as a bearer
// token, so it stays out of request URLs and the logs that record them.

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerTokenFrom(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

export type WorkspaceAuthorisation =
  | { kind: 'authorised'; workspace: WorkspaceAccess }
  | { kind: 'not_found' }
  | { kind: 'unauthorised' };

/** Whether `accessToken` is the secret of the workspace published at `publicSlug`. */
export async function authoriseWorkspace(
  database: Queryable,
  publicSlug: string,
  accessToken: string | null,
): Promise<WorkspaceAuthorisation> {
  const workspace = await loadWorkspaceAccess(database, publicSlug);
  if (workspace === null) return { kind: 'not_found' };
  if (accessToken === null) return { kind: 'unauthorised' };
  const presented = Buffer.from(sha256Hex(accessToken), 'hex');
  const stored = Buffer.from(workspace.accessTokenHash, 'hex');
  const matches = presented.length === stored.length && timingSafeEqual(presented, stored);
  return matches ? { kind: 'authorised', workspace } : { kind: 'unauthorised' };
}

/**
 * For a route handler: the workspace a request may change, or the error response to
 * send. 404 for a slug no workspace has, 401 for a missing or wrong token.
 */
export async function authoriseWorkspaceRequest(
  database: Queryable,
  request: Request,
  publicSlug: string,
): Promise<{ workspace: WorkspaceAccess; response?: never } | { workspace?: never; response: Response }> {
  const authorisation = await authoriseWorkspace(database, publicSlug, bearerTokenFrom(request.headers));
  switch (authorisation.kind) {
    case 'authorised':
      return { workspace: authorisation.workspace };
    case 'not_found':
      return { response: Response.json({ error: 'There is no workspace here.' }, { status: 404 }) };
    case 'unauthorised':
      return {
        response: Response.json(
          { error: "Send the workspace's secret token as \"Authorization: Bearer <token>\"." },
          { status: 401, headers: { 'www-authenticate': 'Bearer' } },
        ),
      };
  }
}
