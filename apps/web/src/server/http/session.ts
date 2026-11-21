import { createHmac } from 'node:crypto';
import { isSameText, type BasicAuthCredentials } from './basic-auth';

// The browser's login: the form on /login sets a cookie, and src/proxy.ts accepts it in
// place of the Basic auth header. The cookie is an expiry time signed with the shared
// login, so nothing is stored, and changing the username or password signs everyone out.

export const SESSION_COOKIE_NAME = 'llms_txt_session';
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const LOGIN_PATH = '/login';

function signature(expiresAtSeconds: number, credentials: BasicAuthCredentials): string {
  return createHmac('sha256', `${credentials.username}:${credentials.password}`)
    .update(`llms-txt-session:${expiresAtSeconds}`)
    .digest('hex');
}

export function createSessionToken(credentials: BasicAuthCredentials, now: Date = new Date()): string {
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + SESSION_LIFETIME_SECONDS;
  return `${expiresAtSeconds}.${signature(expiresAtSeconds, credentials)}`;
}

/** Whether a session cookie was issued for these credentials and has not expired. */
export function isValidSessionToken(
  token: string | undefined,
  credentials: BasicAuthCredentials,
  now: Date = new Date(),
): boolean {
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(token ?? '');
  if (!match) return false;
  const expiresAtSeconds = Number(match[1]);
  if (expiresAtSeconds * 1000 <= now.getTime()) return false;
  return isSameText(match[2]!, signature(expiresAtSeconds, credentials));
}

/**
 * Where to go after signing in. Only a path on this app is followed, so a link to the
 * login page cannot send someone to another site.
 */
export function pathAfterLogin(requested: string | null | undefined): string {
  if (!requested || !/^\/(?![/\\])[\x21-\x7e]*$/.test(requested)) return '/';
  return requested === LOGIN_PATH || requested.startsWith(`${LOGIN_PATH}?`) ? '/' : requested;
}
