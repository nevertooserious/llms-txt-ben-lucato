// Generate screen: URL input, then progress polled from pipeline_runs
// (docs/design/README.md, section 6). Not wired up yet.
export default function HomePage() {
  return (
    <main>
      <h1>llms.txt generator</h1>
      <form>
        <label htmlFor="site-url">Website URL</label>
        <input id="site-url" name="siteUrl" type="url" placeholder="https://example.com" required />
        <button type="submit" disabled>
          Generate
        </button>
      </form>
    </main>
  );
}
