import { apiError } from './api-response';
import { SIGNED_IN_USER_HEADER } from './session';

/** The id of the user a request is from, as src/proxy.ts established it; null when signed out. */
export function signedInUserIdOf(request: Request): string | null {
  return request.headers.get(SIGNED_IN_USER_HEADER);
}

/** For a route handler: the signed-in user's id, or the 401 to send. */
export function requiredUser(request: Request): { userId: string; response?: never } | { userId?: never; response: Response } {
  const userId = signedInUserIdOf(request);
  if (userId === null) {
    return { response: apiError(401, 'unauthorized', 'Send a username and password with HTTP Basic auth.') };
  }
  return { userId };
}
