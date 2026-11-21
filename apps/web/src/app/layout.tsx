import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
});

export const metadata: Metadata = {
  title: 'llms.txt generator',
  description: 'Generate an llms.txt for a website and keep it up to date.',
};

export const viewport = { themeColor: '#08090a' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexMono.variable} ${instrumentSerif.variable}`}>
      <body>
        <div className="page">
          <header className="masthead">
            <Link href="/" className="wordmark">
              <span className="wordmark-glyph" aria-hidden="true" />
              llms.txt generator
            </Link>
            <a href="https://llmstxt.org" target="_blank" rel="noreferrer">
              Spec ↗
            </a>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
