import type { FixtureRoutes } from '../../support/fixture-site-server';

// Responses a well-behaved site never sends. Each route is one failure case.

const page = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body><p>${title}</p></body></html>`;

export const routes: FixtureRoutes = {
  // Redirects to whatever ?to= says: lets a test aim a redirect at any address.
  '/redirect': (_request, response, requestUrl) => {
    response.writeHead(302, { location: requestUrl.searchParams.get('to') ?? '/' }).end();
  },

  // Redirects three times, then lands on a page.
  '/redirect-chain': (_request, response, requestUrl) => {
    const hop = Number(requestUrl.searchParams.get('hop') ?? '0');
    if (hop >= 3) {
      response.writeHead(200, { 'content-type': 'text/html' }).end(page('End of the chain'));
      return;
    }
    response.writeHead(301, { location: `/redirect-chain?hop=${hop + 1}` }).end();
  },

  '/redirect-loop': (_request, response) => {
    response.writeHead(302, { location: '/redirect-loop' }).end();
  },

  // Sends headers and never a body.
  '/slow-body': (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.write('<!doctype html><html><body>');
  },

  // Never responds at all.
  '/no-response': () => undefined,

  '/server-error': (_request, response) => {
    response.writeHead(500, { 'content-type': 'text/html' }).end(page('Internal server error'));
  },

  '/gone': (_request, response) => {
    response.writeHead(410, { 'content-type': 'text/html' }).end(page('Gone'));
  },

  // Streams 8 MB with no Content-Length, so only counting bytes can catch it.
  '/huge-streamed': (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    const chunk = Buffer.alloc(64 * 1024, 'a');
    let chunksLeft = 128;
    const writeMore = () => {
      while (chunksLeft > 0) {
        chunksLeft -= 1;
        if (!response.write(chunk)) {
          response.once('drain', writeMore);
          return;
        }
      }
      response.end();
    };
    response.on('error', () => undefined);
    writeMore();
  },

  // Declares a length over the cap up front.
  '/huge-declared': (_request, response) => {
    response.on('error', () => undefined);
    response.writeHead(200, { 'content-type': 'text/html', 'content-length': String(50 * 1024 * 1024) });
    response.write('<!doctype html>');
  },

  '/report.pdf': (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4 not really');
  },

  '/no-content-type': (_request, response) => {
    response.writeHead(200).end(page('No content type'));
  },

  // Answers a conditional GET with 304 when the ETag matches.
  '/conditional': (request, response) => {
    const etag = '"version-1"';
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { etag }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html', etag }).end(page('Conditional'));
  },

  // A page whose script and iframes reach for every address in ?targets= (comma-separated).
  // Rendered by the headless browser, each must be refused by the SSRF guard.
  '/browser-ssrf': (_request, response, requestUrl) => {
    const targets = (requestUrl.searchParams.get('targets') ?? '').split(',').filter(Boolean);
    const frames = targets.map((target) => `<iframe src="${target}"></iframe>`).join('');
    const script = `
      var targets = ${JSON.stringify(targets)};
      targets.forEach(function (target) { fetch(target).catch(function () {}); });
      var xhr = new XMLHttpRequest(); xhr.open('GET', targets[0] || '/'); xhr.send();
      document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Script ran and tried ' + targets.length + ' targets.</p>');`;
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><html><head><title>Browser SSRF</title></head><body><main><h1>Browser SSRF</h1></main>${frames}<script>${script}</script></body></html>`);
  },

  // Echoes the request headers the crawler sent.
  '/echo-headers': (request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(request.headers));
  },
};
