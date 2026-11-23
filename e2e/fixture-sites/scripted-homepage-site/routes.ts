import type { FixtureRoutes } from '../../support/fixture-site-server';

// A landing page whose links a script writes, over pages the server renders in full: the
// shape of documentation behind a scripted homepage. Every page carries a script that
// changes nothing, so each is worth comparing with its rendered self.

const CHAPTERS = ['install', 'configure', 'deploy', 'upgrade', 'troubleshoot', 'reference'];
const INERT_SCRIPT = '<script>window.loaded = true;</script>';

export const routes: FixtureRoutes = {
  '/': (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(
      `<!doctype html><html lang="en"><head><title>Scripted Home</title></head><body>
      <p>Documentation for a product, introduced at some length on its landing page.</p><div id="chapters"></div>
      <script>document.getElementById('chapters').innerHTML = ${JSON.stringify(
        CHAPTERS.map((chapter) => `<a href="/${chapter}">${chapter}</a>`).join(' '),
      )};</script></body></html>`,
    );
  },
  '*': (_request, response, requestUrl) => {
    const chapter = requestUrl.pathname.slice(1);
    if (!CHAPTERS.includes(chapter)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><html lang="en"><head><title>${chapter}</title></head><body><p>How to ${chapter}, explained in full by the server.</p>${INERT_SCRIPT}</body></html>`);
  },
};
