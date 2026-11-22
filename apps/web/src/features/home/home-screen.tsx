'use client';

import { useSyncExternalStore } from 'react';
import { loadSavedSites, type SavedSite } from '@/browser/saved-sites';
import { SitesTable } from './sites-table';
import { SubmitSiteForm } from './submit-site-form';

// Read once per mount; the list only changes when this browser submits a site, which
// navigates away. Cached so useSyncExternalStore sees a stable snapshot.
let cachedSnapshot: SavedSite[] | null = null;
const readSnapshot = () => (cachedSnapshot ??= loadSavedSites());
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
        <span className="label">For any website</span>
        <h1 className="hero-title">
          An <em>llms.txt</em> for your site,
          <br />
          kept current.
        </h1>
        <p className="hero-lede">
          Paste a URL and let us do the rest.
        </p>
        <SubmitSiteForm />
        <DemoLink demoPath={demoPath} />
      </section>
    </main>
  );
}
