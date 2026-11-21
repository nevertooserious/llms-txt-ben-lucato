import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginScreen } from '@/features/login/login-screen';
import { basicAuthCredentials } from '@/server/http/basic-auth';
import { isValidSessionToken, pathAfterLogin, SESSION_COOKIE_NAME } from '@/server/http/session';
import { signIn } from './actions';

export const metadata: Metadata = { title: 'Sign in · llms.txt generator' };

// What the app is, and the form that lets you in. src/proxy.ts sends signed-out visitors
// here with the page they wanted in `next`.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const nextPath = pathAfterLogin(typeof next === 'string' ? next : null);
  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (isValidSessionToken(sessionToken, basicAuthCredentials())) redirect(nextPath);
  return <LoginScreen signIn={signIn} nextPath={nextPath} />;
}
