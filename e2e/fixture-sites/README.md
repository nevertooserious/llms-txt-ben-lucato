# Fixture sites

Small local websites, one per kind of site the crawler and generator must handle,
served during end-to-end tests. Local, so tests are deterministic, work offline, and can
exercise SSRF and failure cases safely.

Each directory is one site. `e2e/support/fixture-site-server.ts` serves it on its own
loopback port: files as they are, plus scripted responses from the site's `routes.ts`
when it has one (redirects, errors, slow or huge bodies). HTML is served without a
charset parameter, so a page's own `<meta charset>` decides its encoding.

| Site | What it is |
|---|---|
| `static-site` | Server-rendered pages with no JavaScript; robots.txt disallowing `/private/`; a sitemap listing a page nothing links to; a windows-1252 page and a PNG |
| `client-app-shell` | An empty shell for every path; JavaScript renders each route and the navigation, and loads part of the homepage after a timer |
| `metadata-ssr-site` | Title and description in the server's HTML; body rendered by JavaScript |
| `hydrated-site` | Fully server-rendered, with a hydration script that changes no text; no sitemap |
| `hash-routing-site` | Routes on the URL fragment (`/#/install`), one route two segments deep and one with a `.md` file beside the page |
| `mixed-site` | Server-rendered, except one client-rendered section at `/app/` |
| `markdown-site` | An existing llms.txt and `.md` variants for some pages |
| `large-sitemap-site` | A sitemap index of 1,500 generated posts |
| `rate-limited-site` | A page that answers 429 with `Retry-After` before serving |
| `conventions-site` | One route per open convention: robots.txt served as `text/html`, gzipped and plain-text sitemaps, a redirect into a disallowed path, a URL that only works with its trailing slash, `X-Robots-Tag: nofollow`, `noindex`, and 503 with `Retry-After` |
| `robots-unreachable-site` | robots.txt answers 500 |
| `crawl-delay-site` | robots.txt sets `Crawl-delay: 1`, and every page links to another |
| `changing-site` | Only scripted routes: a homepage linking to pages whose titles, descriptions, statuses and links a test changes between monitor checks |
| `editable-site` | Like `changing-site`, but each served copy has its own state (keyed by port), so every test edits a fresh site: descriptions, body noise, new pages, 404s, 5xx, unlinked pages. ETags and 304s like a static server |
| `hostile-site` | Only scripted routes: redirect chains and loops, open redirects, timeouts, oversized bodies, error statuses, non-HTML types, and a page whose scripts reach for private addresses |

Tests reach these sites through `allowLoopbackPorts` in `e2e/support/local-network-policy.ts`,
which opens exactly the fixture ports and nothing else. `../tests/crawler.test.ts`, `../tests/crawler-conventions.test.ts`
and `../tests/http-fetcher.test.ts` test the crawler against these sites. `../tests/monitor.test.ts` runs monitor checks against `changing-site`.
`../tests/site-flavours.test.ts` runs the whole pipeline against the rest through the real
worker and Postgres, including changes over time with `editable-site`.