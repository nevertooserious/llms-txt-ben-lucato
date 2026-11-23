import { createHmac } from 'node:crypto';
import { isSameText } from './basic-auth';

// The browser's login: the form on /login sets a cookie, and src/proxy.ts accepts it in
// place of the Basic auth header. The cookie names the user and an expiry time, signed
// with that user's stored password hash, so no session is stored, and changing a
// password signs that user out everywhere.

export const SESSION_COOKIE_NAME = 'llms_txt_session';
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const LOGIN_PATH = '/login';

/**
 * The request header in which src/proxy.ts tells the routes who is signed in. The proxy
 * removes whatever a client sent under this name, so only it can set it.
 */
export const SIGNED_IN_USER_HEADER = 'x-llms-txt-user-id';

/** What a session is issued for and checked against: a row of `users`. */
export interface SessionUser {
  id: string;
  passwordHash: string;
}

const TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,12})\.([0-9a-f]{64})$/;

function signature(user: SessionUser, expiresAtSeconds: number): string {
  return createHmac('sha256', user.passwordHash).update(`llms-txt-session:${user.id}:${expiresAtSeconds}`).digest('hex');
}

export function createSessionToken(user: SessionUser, now: Date = new Date()): string {
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + SESSION_LIFETIME_SECONDS;
  return `${user.id}.${expiresAtSeconds}.${signature(user, expiresAtSeconds)}`;
}

/** The user a session cookie claims to be for, to look up before isValidSessionToken. Null if it is not a token. */
export function userIdOfSessionToken(token: string | undefined): string | null {
  return TOKEN_PATTERN.exec(token ?? '')?.[1] ?? null;
}

/** Whether a session cookie was issued for this user, with their current password, and has not expired. */
export function isValidSessionToken(token: string | undefined, user: SessionUser, now: Date = new Date()): boolean {
  const match = TOKEN_PATTERN.exec(token ?? '');
  if (match?.[1] !== user.id) return false;
  const expiresAtSeconds = Number(match[2]);
  if (expiresAtSeconds * 1000 <= now.getTime()) return false;
  return isSameText(match[3]!, signature(user, expiresAtSeconds));
}

/**
 * Where to go after signing in. Only a path on this app is followed, so a link to the
 * login page cannot send someone to another site.
 */
export function pathAfterLogin(requested: string | null | undefined): string {
  if (!requested || !/^\/(?![/\\])[\x21-\x7e]*$/.test(requested)) return '/';
  return requested === LOGIN_PATH || requested.startsWith(`${LOGIN_PATH}?`) ? '/' : requested;
}
