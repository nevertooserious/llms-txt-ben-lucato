import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { basicAuthCredentials } from '@/server/http/basic-auth';
import { isValidSessionToken, SESSION_COOKIE_NAME } from '@/server/http/session';
import { signOut } from './login/actions';
import './globals.css';

const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'llms.txt generator',
  description: 'Generate an llms.txt for a website and keep it up to date.',
};

export const viewport = { themeColor: '#f4f4f4' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const isSignedIn = isValidSessionToken(sessionToken, basicAuthCredentials());
  return (
    <html lang="en" className={geistMono.variable}>
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <Link href="/" className="wordmark">
              llms.txt generator
            </Link>
            <nav className="masthead-links">
              <a href="https://llmstxt.org" target="_blank" rel="noreferrer">
                Spec ↗
              </a>
              {isSignedIn && (
                <form action={signOut}>
                  <button type="submit" className="link-button">
                    Sign out
                  </button>
                </form>
              )}
            </nav>
          </div>
        </header>
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
