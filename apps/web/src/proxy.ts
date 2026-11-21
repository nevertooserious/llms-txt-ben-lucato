import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from './server/http/api-response';
import { basicAuthCredentials, isAuthorised, isPublicPath } from './server/http/basic-auth';

const CHALLENGE = { 'www-authenticate': 'Basic realm="llms.txt generator", charset="UTF-8"', 'cache-control': 'no-store' };

// Every request but the public ones needs the login. A browser answers the challenge with
// its own sign-in prompt, then sends the login with the page's API calls too.
export function proxy(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname) || isAuthorised(request.headers.get('authorization'), basicAuthCredentials())) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/')) {
    return apiError(401, 'unauthorized', 'Send a username and password with HTTP Basic auth.', CHALLENGE);
  }
  return new Response('Sign in to use this app.\n', {
    status: 401,
    headers: { ...CHALLENGE, 'content-type': 'text/plain; charset=utf-8' },
  });
}
