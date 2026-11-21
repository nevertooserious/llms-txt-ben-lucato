import type { FixtureRoutes } from '../../support/fixture-site-server';

// A small server-rendered site whose pages a test changes between monitor checks.
// Every page is scripted from `changingSite`, which the test imports and edits. The
// homepage links to every page whose `isLinked` is set; a page that is not linked is
// still served, so a re-check of a known URL sees whatever it now answers.

export interface ChangingPage {
  title: string;
  description: string;
  /** 200 serves the page; 404 or 410 answers not found. */
  status: number;
  isLinked: boolean;
}

const INITIAL_PAGES: Record<string, ChangingPage> = {
  '/docs': { title: 'Docs', description: 'How to use Acme.', status: 200, isLinked: true },
  '/pricing': { title: 'Pricing', description: 'What Acme costs.', status: 200, isLinked: true },
  '/blog/launch': { title: 'Launch post', description: 'Acme is out.', status: 200, isLinked: true },
};

export const changingSite = {
  pages: structuredClone(INITIAL_PAGES),
  reset(): void {
    this.pages = structuredClone(INITIAL_PAGES);
  },
};

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function pageHtml(title: string, description: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
</head>
<body>
${body}
</body>
</html>
`;
}

export const routes: FixtureRoutes = {
  '/': (_request, response) => {
    const links = Object.entries(changingSite.pages)
      .filter(([, page]) => page.isLinked)
      .map(([path, page]) => `<li><a href="${path}">${escapeHtml(page.title)}</a></li>`)
      .join('\n');
    const body = `<nav><ul>\n${links}\n</ul></nav>\n<main><h1>Acme</h1><p>Acme makes tools for building things that last, and this is its website.</p></main>`;
    response.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml('Acme', 'Tools that last.', body));
  },
  '*': (_request, response, requestUrl) => {
    const page = changingSite.pages[requestUrl.pathname];
    if (page === undefined || page.status !== 200) {
      response.writeHead(page?.status ?? 404, { 'content-type': 'text/html' }).end('<!doctype html><title>Not found</title>');
      return;
    }
    const body = `<main><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.description)} Some more words so this counts as content.</p></main>`;
    response.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml(page.title, page.description, body));
  },
};
