import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from './server/http/api-response';
import { basicAuthCredentials, isAuthorised, isPublicPath } from './server/http/basic-auth';
import { isValidSessionToken, LOGIN_PATH, SESSION_COOKIE_NAME } from './server/http/session';

const NO_STORE = { 'cache-control': 'no-store' };
const CHALLENGE = { 'www-authenticate': 'Basic realm="llms.txt generator", charset="UTF-8"' };

// Every request but the public ones needs the login: the cookie the login page sets, or
// HTTP Basic auth, which is what API clients send. A page without either goes to the
// login page, and comes back to where it was headed once signed in.
export function proxy(request: NextRequest): Response {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const credentials = basicAuthCredentials();
  if (
    isAuthorised(request.headers.get('authorization'), credentials) ||
    isValidSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value, credentials)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    // A browser answers the challenge with its own sign-in prompt, so the app's own
    // pages are not sent it; they go to the login page instead (browser/login-redirect.ts).
    const isFromThisApp = request.headers.get('sec-fetch-site') === 'same-origin';
    return apiError(401, 'unauthorized', 'Send a username and password with HTTP Basic auth.', {
      ...NO_STORE,
      ...(isFromThisApp ? {} : CHALLENGE),
    });
  }

  const loginUrl = new URL(LOGIN_PATH, request.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl, { headers: NO_STORE });
}
