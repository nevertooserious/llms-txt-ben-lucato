import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from './server/http/api-response';
import { webServices } from './server/composition/web-services';
import { isPublicPath } from './server/http/basic-auth';
import { LOGIN_PATH, SESSION_COOKIE_NAME, SIGNED_IN_USER_HEADER } from './server/http/session';
import { userIdOfRequest } from './server/users/authentication';

const NO_STORE = { 'cache-control': 'no-store' };
const CHALLENGE = { 'www-authenticate': 'Basic realm="llms.txt generator", charset="UTF-8"' };

async function signedInUserIdOf(request: NextRequest): Promise<string | null> {
  const services = webServices();
  await services.configuredUserIsReady();
  return userIdOfRequest(services.databasePool, {
    authorizationHeader: request.headers.get('authorization'),
    sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

// Every request but the public ones needs a user: the cookie the login page sets, or
// HTTP Basic auth, which is what API clients send. The routes are told who it is in a
// request header only this proxy can set. A page without a user goes to the login page,
// and comes back to where it was headed once signed in.
export async function proxy(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete(SIGNED_IN_USER_HEADER);
  const proceed = () => NextResponse.next({ request: { headers: forwardedHeaders } });

  // The login page is public but shows a signed-in user straight through, so it is told too.
  const isPublic = isPublicPath(pathname);
  if (isPublic && pathname !== LOGIN_PATH) return proceed();

  let userId: string | null;
  try {
    userId = await signedInUserIdOf(request);
  } catch (error) {
    if (isPublic) return proceed();
    webServices().logger.error('checking the login failed', { error });
    return pathname.startsWith('/api/')
      ? apiError(500, 'internal_error', 'The login could not be checked.', { headers: NO_STORE })
      : new Response('The login could not be checked. Try again shortly.', { status: 503, headers: NO_STORE });
  }
  if (userId !== null) {
    forwardedHeaders.set(SIGNED_IN_USER_HEADER, userId);
    return proceed();
  }
  if (isPublic) return proceed();

  if (pathname.startsWith('/api/')) {
    // A browser answers the challenge with its own sign-in prompt, so the app's own
    // pages are not sent it; they go to the login page instead (browser/login-redirect.ts).
    const isFromThisApp = request.headers.get('sec-fetch-site') === 'same-origin';
    return apiError(401, 'unauthorized', 'Send a username and password with HTTP Basic auth.', {
      headers: { ...NO_STORE, ...(isFromThisApp ? {} : CHALLENGE) },
    });
  }
  const loginUrl = new URL(LOGIN_PATH, request.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl, { headers: NO_STORE });
}
