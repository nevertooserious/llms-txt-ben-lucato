import { createHash, timingSafeEqual } from 'node:crypto';

// HTTP Basic auth, which is what API clients sign in with: the same username and
// password the browser gives once on /login in return for a cookie (session.ts). Who
// they belong to is decided in server/users/authentication.ts.

/** The login the app is configured with; the one user is made from it. */
export interface BasicAuthCredentials {
  username: string;
  password: string;
}

/** Compared as hashes, so neither the time taken nor the length gives the value away. */
export function isSameText(presented: string, expected: string): boolean {
  const hash = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(hash(presented), hash(expected));
}

/** The username and password an `Authorization` header carries, or null if it is not Basic auth. */
export function basicAuthLogin(authorizationHeader: string | null): BasicAuthCredentials | null {
  const encoded = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(authorizationHeader ?? '')?.[1];
  if (encoded === undefined) return null;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  // A username cannot contain a colon; a password can (RFC 7617).
  const separator = decoded.indexOf(':');
  if (separator === -1) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
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
