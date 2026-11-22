import { headers } from 'next/headers';
import { SIGNED_IN_USER_HEADER } from './session';

/** For a page or layout, which has no request object: the signed-in user's id, or null when signed out. */
export async function signedInUserId(): Promise<string | null> {
  return (await headers()).get(SIGNED_IN_USER_HEADER);
}
