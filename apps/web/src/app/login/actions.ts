'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { basicAuthCredentials, isCorrectLogin } from '@/server/http/basic-auth';
import {
  createSessionToken,
  LOGIN_PATH,
  pathAfterLogin,
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
} from '@/server/http/session';
import type { SignInState } from '@/shared/sign-in';

/** Checks the login form and, if it is right, sets the session cookie and moves on. */
export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const credentials = basicAuthCredentials();
  if (!isCorrectLogin(text('username'), text('password'), credentials)) {
    return { errorMessage: 'That username or password is not right.', username: text('username') };
  }

  const requestHeaders = await headers();
  (await cookies()).set(SESSION_COOKIE_NAME, createSessionToken(credentials), {
    httpOnly: true,
    // Lax keeps the cookie off requests other sites make to the API.
    sameSite: 'lax',
    secure: requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https',
    path: '/',
    maxAge: SESSION_LIFETIME_SECONDS,
  });
  redirect(pathAfterLogin(text('next')));
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
  redirect(LOGIN_PATH);
}
