'use client';

import { useSyncExternalStore } from 'react';
import { loadSavedWorkspaces, type SavedWorkspace } from '@/browser/saved-workspaces';
import { SitesTable } from './sites-table';
import { SubmitSiteForm } from './submit-site-form';

// Read once per mount; the list only changes when this browser submits a site, which
// navigates away. Cached so useSyncExternalStore sees a stable snapshot.
let cachedSnapshot: SavedWorkspace[] | null = null;
const readSnapshot = () => (cachedSnapshot ??= loadSavedWorkspaces());
const subscribe = () => () => {
  cachedSnapshot = null;
};

function DemoLink({ demoPath }: { demoPath: string | null }) {
  if (demoPath === null) return null;
  return (
    <a className="button demo-link" href={demoPath}>
      Open the demo site →
    </a>
  );
}

/** The sites this browser has started, or an introduction if there are none yet. */
export function HomeScreen({ demoPath }: { demoPath: string | null }) {
  // The list is in localStorage, so the server renders neither view and the intro cannot flash.
  const sites = useSyncExternalStore(subscribe, readSnapshot, () => null);
  if (sites === null) return <main />;

  if (sites.length > 0) {
    return (
      <main>
        <section className="sites-home">
          <h1>Your sites</h1>
          <SubmitSiteForm />
          <DemoLink demoPath={demoPath} />
        </section>
        <SitesTable sites={sites} />
      </main>
    );
  }

  return (
    <main>
      <section className="hero">
        <span className="label">For any website · per llmstxt.org</span>
        <h1 className="hero-title">
          An <em>llms.txt</em> for your site,
          <br />
          kept current.
        </h1>
        <p className="hero-lede">
          Paste a URL. We crawl the site, read each page, and write an llms.txt you can host. Turn on monitoring
          and it is rewritten when the site changes.
        </p>
        <SubmitSiteForm />
        <DemoLink demoPath={demoPath} />
        <div className="steps">
          <div className="step">
            <span className="label">01 · Crawl</span>
            <h2>Sitemap, navigation, links</h2>
            <p>Renders JavaScript-heavy pages in a headless browser when it needs to.</p>
          </div>
          <div className="step">
            <span className="label">02 · Generate</span>
            <h2>Sections by page type</h2>
            <p>Titles and descriptions from each page, checked against the spec.</p>
          </div>
          <div className="step">
            <span className="label">03 · Host &amp; monitor</span>
            <h2>A stable URL</h2>
            <p>Point /llms.txt at it. Scheduled checks keep it up to date.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
