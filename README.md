# llms.txt generator

A web app that takes a website URL, generates an [llms.txt](https://llmstxt.org) for it, and keeps it up to date as the site changes. The design is in [`docs/design/README.md`](docs/design/README.md).

Status: the extractor, the crawler, the run lifecycle (submission, queueing, reaper, monitor tick), the run itself (crawl, extract, reconcile, publish), the generator and monitoring (on from submission, scheduled checks, "check now") are implemented. So is the UI for generating a file (submit a URL, watch the run, preview, copy, download, the hosted URL) for monitoring ("check now"), for choosing which version is live, and for deleting a site. With `ANTHROPIC_API_KEY` set, Claude Haiku assesses each candidate page (description, whether it belongs, page type) and Claude Opus writes the site summary and, where a site needs them, a few notes under it. The file also lists the machine-readable files a site has (`llms-full.txt`, section `llms.txt` files, OpenAPI descriptions). These calls have not yet run against the live API. Without a key the worker uses heuristics, which is meant only for local development and tests.

## Layout

An npm workspaces monorepo. Each design component is its own package, so its boundaries are real imports.

| Path | What it is |
|---|---|
| `apps/web` | Next.js: the UI, the API, and the hosted `/w/{slug}/llms.txt` |
| `apps/worker` | Node worker: consumes pg-boss jobs and runs the pipeline and the monitor tick |
| `packages/contracts` | Types passed between stages (`RawPage`, `PageRecord`, …) and queue names |
| `packages/crawler` | All network I/O to target sites, the SSRF guard, Playwright |
| `packages/extractor` | Pure function from HTML to `PageRecord`; no I/O |
| `packages/generator` | Page selection, LLM calls, rendering and spec validation |
| `packages/monitor` | Enqueues due checks and reaps stale runs |
| `packages/db` | Postgres access: all SQL, one module per table, and the pipeline-run queue; `db/schema.sql` is the schema |
| `packages/runtime` | Process plumbing for the web app and worker: typed environment config and structured JSON logs |
| `e2e` | End-to-end tests against local fixture sites |

ESLint enforces the boundaries: the extractor may not import network, filesystem or database modules; only the crawler may import network modules; only `packages/db` may import `pg`; and contracts, the extractor, the generator and the crawler may not touch the database or the queue.

### Inside a component

Each package's `src/` is grouped by layer, and `src/index.ts` is its only entry point: other packages import the package, never a file inside it.

| Component | Folders |
|---|---|
| `packages/contracts` | One module per hand-off: `crawl`, `page-record`, `page-assessment`, `generation`, `pipeline-jobs`, `machine-readable-resources` |
| `packages/crawler` | `network/` (HTTP fetcher, headless renderer, SSRF guard), `discovery/` (robots.txt, sitemaps, URL normalisation), `page-signals/` (what a fetched page says about itself and whether to render it), `crawl/` (the crawl loop that uses the other three) |
| `packages/extractor` | `html/` (parsing, main content, links), `record/` (markdown, page type, hashes); `extract-page.ts` puts them together |
| `packages/generator` | `selection/` (candidates, scores, sections, limits), `entry-text/` (site name, titles, descriptions), `enrichment/` (LLM prompts, parsing, cache hashes), `rendering/` (render and validate), `publication/` (publish or not) |
| `packages/monitor` | `decisions/` (pure: page reconciliation, safety gate, sitemap trust), `scheduling/` (the tick) |
| `packages/db` | `connection/` (pool, transactions), `repositories/` (one module per table), `queue/` (the pipeline-run queue) |
| `apps/worker` | `main.ts` (composition root), `config/`, `jobs/` (queue consumers), `llm/` (Anthropic client), `pipeline/` (the run's lifecycle, and one module per stage in `pipeline/stages/`) |
| `apps/web` | `app/` (Next.js routes only), `features/` (React components, by screen: `home/`, `site/`), `browser/` (API client, local storage), `server/` (`sites/`, `http/`, `composition/`), `shared/` (types and pure helpers for both sides) |

ESLint enforces these layers too. In the crawler only `network/` may open a connection, so every request is made beside the SSRF guard. In `packages/db` only `connection/` imports `pg`. The worker's pipeline is handed its dependencies and does not import the worker's wiring. In the web app, routes in `app/` call `server/` and render `features/`; server and browser code share only `shared/`. The web app imports across its folders with the `@/` alias (`@/server/...`).

## Quick start with Docker

```sh
docker compose up --build                # http://localhost:3000
```

This starts Postgres (with `db/schema.sql` applied on first boot), the web app and the worker. No configuration is needed. To use Claude rather than heuristics, put `ANTHROPIC_API_KEY` in a `.env` file at the repository root and run the command again. `WEB_PORT` (default 3000) and `POSTGRES_PORT` (default 5433) change the host ports.

A new database also gets a demo site with four versions, linked from the home page and at <http://localhost:3000/w/demo>. `db/demo-seed.sql` is applied only by this local stack. The site is not real, so "Check now" on it ends in a failed run and keeps the published file.

The schema and demo are applied only to an empty database, so to change the schema or restore the demo run `docker compose down --volumes`, which deletes all local data. The crawler's SSRF guard refuses private addresses, so this stack cannot crawl a site running on your machine.

## Setup without Docker

Needs Node 24 and Postgres 14 or later.

```sh
npm ci
npx playwright install chromium          # headless browser for the crawler
cp .env.example .env                     # set DATABASE_URL
psql "$DATABASE_URL" -f db/schema.sql
npm run dev:web                          # http://localhost:3000
npm run dev:worker
```

Each process reads its configuration once at startup and stops with a message naming any missing or malformed variable. `DATABASE_URL` is required, and production also needs `ANTHROPIC_API_KEY` (worker); `LOG_LEVEL` (`debug`, `info`, `warn`, `error`), `PIPELINE_RUN_CONCURRENCY` and `CRAWL_PAGE_BUDGET` (worker) and `SUBMISSIONS_PER_IP_PER_HOUR` and `TRUSTED_PROXY_HOPS` (web) are optional. Logs are one JSON object per line; a run's lines carry its `pipelineRunId`.

## Serving llms.txt from your own domain

The spec puts the file at `/llms.txt` on your site. Each site has a stable hosted URL, `https://<app>/w/<slug>/llms.txt`, shown on its page, which serves the latest version unless you pin another on that page. Point your own path at it with a proxy, which keeps your domain in the response, or a redirect.

```nginx
# nginx: proxy
location = /llms.txt {
  proxy_pass https://<app>/w/<slug>/llms.txt;
  proxy_ssl_server_name on;
}
```

```text
# Netlify or Cloudflare Pages, in _redirects: 200 proxies (Netlify only), 302 redirects
/llms.txt https://<app>/w/<slug>/llms.txt 302
```

```json
{ "redirects": [{ "source": "/llms.txt", "destination": "https://<app>/w/<slug>/llms.txt", "permanent": false }] }
```

The last one is for Vercel, in `vercel.json`. Use a temporary redirect, so clients keep asking your domain.

## REST API

There is no authentication yet, so anyone who knows a site's slug can read, change or delete it. Do not expose a deployment you need to protect until basic auth is added.

| Action | Request |
|---|---|
| Submit a site | `POST /api/sites` with `{"url": "https://example.com"}` |
| Get a site | `GET /api/sites/{slug}` |
| Delete a site | `DELETE /api/sites/{slug}` |
| Re-trigger a site | `POST /api/sites/{slug}/runs` |
| Check a run's status | `GET /api/sites/{slug}/runs/{runId}` |
| Get the file a run published | `GET /api/sites/{slug}/runs/{runId}/llms.txt` |
| List versions | `GET /api/sites/{slug}/versions` |
| Get a version as JSON | `GET /api/sites/{slug}/versions/{n}` |
| Get a version as text | `GET /api/sites/{slug}/versions/{n}/llms.txt` |
| Pin a version | `PUT /api/sites/{slug}/published-version` with `{"versionNumber": 2}` |
| Follow the latest version | `DELETE /api/sites/{slug}/published-version` |
| Get the live file | `GET /w/{slug}/llms.txt` |

```sh
# Submit, then poll the run until it finishes.
curl -si localhost:3000/api/sites -H 'content-type: application/json' -d '{"url":"https://example.com"}'
# 202, with {"publicSlug", "pipelineRunId", "runUrl", "llmsTxtUrl"}
curl -s localhost:3000/api/sites/<slug>/runs/<runId>
# {"status": "running", "currentStage": "crawl", "pagesFetchedCount": 12, "versionNumber": null, ...}
```

A run's `status` is `queued`, `running`, `succeeded`, `unchanged` or `failed`. While it is active, the response has a `Retry-After` header. Re-triggering during a run returns that run, and re-triggering within five minutes of the last run answers 429 with `Retry-After`.

Errors are JSON with a message and a stable code, such as `{"error": "This site has no such run.", "code": "run_not_found"}`. The codes are `invalid_request`, `invalid_url`, `invalid_version_number`, `site_not_found`, `run_not_found`, `version_not_found`, `run_in_progress`, `run_produced_no_version`, `rate_limited`, `cooldown_active` and `internal_error`. Plain-text versions have an `ETag` and answer `If-None-Match` with 304.

## Checks

| Command | What it runs |
|---|---|
| `scripts/lint.sh` | ESLint, typecheck, and checks on diagrams and scripts |
| `scripts/test.sh` | Unit tests (Vitest) and tests for `scripts/` |
| `scripts/validate-schema.sh`, `npm run test:database` | Apply `db/schema.sql` to Postgres and check it against the contracts enums; CI only (`schema` job) |
| `scripts/test-e2e.sh` | End-to-end tests against local fixture sites; in CI, runs inside the pinned Playwright image (`e2e` job). The pipeline and monitor tests run the real worker, and the browser tests (`e2e/tests/browser.test.ts`) drive the web app in headless Chromium through submitting a site and "check now". These need `DATABASE_URL` (the browser tests create and drop a database of their own, so the role must be allowed to create databases) and are skipped locally without it |

The same scripts run locally and in CI. The end-to-end tests listen on loopback ports, so a sandbox that blocks local binding will make them fail.
