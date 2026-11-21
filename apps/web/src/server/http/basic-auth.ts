import { createHash, timingSafeEqual } from 'node:crypto';
import type { Environment } from '@llms-txt/runtime';

// The login for the whole app (src/proxy.ts). One shared username and password, with no
// accounts: API clients send it with HTTP Basic auth each time, and the browser gives it
// once on /login in return for a cookie (session.ts).

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

export function basicAuthCredentials(environment: Environment = process.env): BasicAuthCredentials {
  return {
    username: environment.BASIC_AUTH_USERNAME || 'user1',
    password: environment.BASIC_AUTH_PASSWORD || 'pass1',
  };
}

/** Compared as hashes, so neither the time taken nor the length gives the value away. */
export function isSameText(presented: string, expected: string): boolean {
  const hash = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(hash(presented), hash(expected));
}

export function isCorrectLogin(username: string, password: string, credentials: BasicAuthCredentials): boolean {
  const isUsernameCorrect = isSameText(username, credentials.username);
  const isPasswordCorrect = isSameText(password, credentials.password);
  return isUsernameCorrect && isPasswordCorrect;
}

/** Whether an `Authorization` header carries these credentials. */
export function isAuthorised(authorizationHeader: string | null, credentials: BasicAuthCredentials): boolean {
  const encoded = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(authorizationHeader ?? '')?.[1];
  if (encoded === undefined) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  // A username cannot contain a colon; a password can (RFC 7617).
  const separator = decoded.indexOf(':');
  if (separator === -1) return false;
  return isCorrectLogin(decoded.slice(0, separator), decoded.slice(separator + 1), credentials);
}

/**
 * Paths served without a login. The hosted file must stay public, because sites proxy
 * or redirect their /llms.txt to it. The rest is the login page, Next's static assets
 * and dev reload.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    /^\/w\/[^/]+\/llms\.txt$/.test(pathname) ||
    pathname.startsWith('/_next/static/') ||
    pathname === '/_next/webpack-hmr'
  );
}
