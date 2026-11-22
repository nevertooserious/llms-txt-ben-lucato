import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginScreen } from '@/features/login/login-screen';
import { pathAfterLogin } from '@/server/http/session';
import { signedInUserId } from '@/server/http/signed-in-page-user';
import { signIn } from './actions';

export const metadata: Metadata = { title: 'Sign in · llms.txt generator' };

// What the app is, and the form that lets you in. src/proxy.ts sends signed-out visitors
// here with the page they wanted in `next`.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const nextPath = pathAfterLogin(typeof next === 'string' ? next : null);
  if ((await signedInUserId()) !== null) redirect(nextPath);
  return <LoginScreen signIn={signIn} nextPath={nextPath} />;
}
