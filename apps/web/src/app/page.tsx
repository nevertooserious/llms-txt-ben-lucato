import { RecentWorkspaces } from './recent-workspaces';
import { SubmitSiteForm } from './submit-site-form';

export default function HomePage() {
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
      <RecentWorkspaces />
    </main>
  );
}
