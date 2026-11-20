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
| `static-site` | Server-rendered pages with no JavaScript, a windows-1252 page and a PNG |
| `hostile-site` | Only scripted routes: redirect chains and loops, open redirects, timeouts, oversized bodies, error statuses, non-HTML types |

Tests reach these sites through `allowLoopbackPorts` in `e2e/support/local-network-policy.ts`,
which opens exactly the fixture ports and nothing else. The planned sites for the other
cases are listed in `../tests/site-flavours.test.ts`.
