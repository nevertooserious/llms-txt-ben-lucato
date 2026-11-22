import type { SiteListEntry } from '@/shared/site-list';
import { SitesTable } from './sites-table';
import { SubmitSiteForm } from './submit-site-form';

function DemoLink({ demoPath }: { demoPath: string | null }) {
  if (demoPath === null) return null;
  return (
    <a className="button demo-link" href={demoPath}>
      Open the demo site →
    </a>
  );
}

/** The signed-in user's sites, or an introduction if there are none yet. */
export function HomeScreen({ sites, demoPath }: { sites: SiteListEntry[]; demoPath: string | null }) {
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
