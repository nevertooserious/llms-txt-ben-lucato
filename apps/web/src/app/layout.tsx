import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'llms.txt generator',
  description: 'Generate an llms.txt for a website and keep it up to date.',
};

export const viewport = { themeColor: '#f4f4f4' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={geistMono.variable}>
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <Link href="/" className="wordmark">
              llms.txt generator
            </Link>
            <a href="https://llmstxt.org" target="_blank" rel="noreferrer">
              Spec ↗
            </a>
          </div>
        </header>
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
