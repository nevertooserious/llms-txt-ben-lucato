import type { FixtureRoutes } from '../../support/fixture-site-server';

// An English site with German and French copies of every page under /de/ and /fr/, all
// linked from each page's language switcher, and one section with a two-letter name that is not a language.

const LANGUAGES = ['en', 'de', 'fr'];
const PAGES = ['guide', 'pricing', 'about'];

const page = (language: string, name: string) =>
  `<!doctype html><html lang="${language}"><head><title>${name} (${language})</title></head><body>
  <nav>${PAGES.map((other) => `<a href="/${language}/${other}">${other}</a>`).join(' ')}</nav>
  <p>${LANGUAGES.map((other) => `<a href="/${other}/${name}">${other}</a>`).join(' ')}</p>
  <p>The ${name} page, in ${language}.</p></body></html>`;

export const routes: FixtureRoutes = {
  '/': (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(
      `<!doctype html><html lang="en"><head><title>Translated Co</title></head><body>
      <nav>${PAGES.map((name) => `<a href="/en/${name}">${name}</a>`).join(' ')} <a href="/ai/agents">AI agents</a></nav>
      <p>${LANGUAGES.map((language) => `<a href="/${language}/guide">${language}</a>`).join(' ')}</p></body></html>`,
    );
  },
  '/ai/agents': (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html lang="en"><title>AI agents</title><p>What the agents do.</p></html>');
  },
  '*': (_request, response, requestUrl) => {
    const [language, name] = requestUrl.pathname.split('/').filter(Boolean);
    if (language === undefined || name === undefined || !LANGUAGES.includes(language) || !PAGES.includes(name)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(page(language, name));
  },
};
