# llms.txt generator

A web app that takes a website URL, generates an [llms.txt](https://llmstxt.org) for it, and keeps it up to date as the site changes. The design is in [`docs/design/README.md`](docs/design/README.md), as diagrams.

Status: the extractor, the crawler, the run lifecycle (submission, queueing, reaper, monitor tick), the run itself (crawl, extract, reconcile, publish), the generator and monitoring (on from submission, scheduled checks, "check now") are implemented. So is the UI for generating a file (submit a URL, watch the run, preview, copy, download, the hosted URL) for monitoring ("check now"), for choosing which version is live, for ignoring pages or whole paths of the site, and for deleting a site. With `ANTHROPIC_API_KEY` set, Claude Haiku assesses each candidate page (description, whether it belongs, page type) and Claude Opus writes the site summary and, where a site needs them, a few notes under it. The file also lists the machine-readable files a site has (`llms-full.txt`, section `llms.txt` files, OpenAPI descriptions). Without a key the worker uses heuristics, which is meant only for local development and tests.

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
| `packages/extractor` | `html/` (parsing, main content), `record/` (markdown, page type, hashes); `extract-page.ts` puts them together |
| `packages/generator` | `selection/` (candidates, scores, sections), `naming/` (site name, entry titles), `text/` (shared text helpers), `enrichment/` (LLM prompts, parsing, cache hashes), `rendering/` (render and validate), `publication/` (publish or not) |
| `packages/monitor` | `scheduling/` (the tick) |
| `packages/db` | `connection/` (pool, transactions), `repositories/` (one module per table), `queue/` (the pipeline-run queue) |
| `apps/worker` | `main.ts` (composition root), `config/`, `jobs/` (queue consumers), `llm/` (Anthropic client), `pipeline/` (the run's lifecycle, one module per stage in `pipeline/stages/`, and the pure rules they call in `pipeline/decisions/`: page reconciliation, safety gate, sitemap trust) |
| `apps/web` | `app/` (Next.js routes only), `features/` (React components, by screen: `home/`, `login/`, `site/`), `browser/` (API client), `server/` (`sites/`, `users/`, `http/`, `composition/`), `shared/` (types and pure helpers for both sides) |

ESLint enforces these layers too. In the crawler only `network/` may open a connection, so every request is made beside the SSRF guard. In `packages/db` only `connection/` imports `pg`. The worker's pipeline is handed its dependencies and does not import the worker's wiring, and its `decisions/` do no I/O and take only types from `packages/db`. The monitor only schedules runs, so it does not import the crawler, extractor or generator. Packages are imported only through their entry point and along the allowed dependencies (`packageDependencies` in `eslint.config.js`). Only the worker's `llm/` uses the Anthropic SDK, only the config modules read `process.env`, and the extractor, generator and pipeline decisions read no clock or randomness. In the web app, routes in `app/` call `server/` and render `features/`; server and browser code share only `shared/`. The web app imports across its folders with the `@/` alias (`@/server/...`).

## Quick start with Docker

```sh
LLM_CLIENT=stub docker compose up --build  # http://localhost:3000, login user1 / pass1
```

This starts Postgres (with `db/schema.sql` applied on first boot), the web app and the worker. `LLM_CLIENT=stub` runs without a model or an API key: pages are kept with their meta descriptions, so the output shows the pipeline working rather than a real file. To use Claude, put `ANTHROPIC_API_KEY` in a `.env` file at the repository root and run `docker compose up --build`. `WEB_PORT` (default 3000) and `POSTGRES_PORT` (default 5433) change the host ports.

A new database also gets a demo site with four versions, linked from the home page and at <http://localhost:3000/w/demo>. `db/demo-seed.sql` is applied only by this local stack. The site is not real, so "Check now" on it ends in a failed run and keeps the published file.

The schema and demo are applied only to an empty database, so to change the schema or restore the demo run `docker compose down --volumes`, which deletes all local data. The crawler's SSRF guard refuses private addresses, so this stack cannot crawl a site running on your machine.

## Setup without Docker

Needs Node 24 and Postgres 14 or later.

```sh
npm ci
npx playwright install chromium          # headless browser for the crawler
cp .env.example .env                     # set DATABASE_URL
psql "$DATABASE_URL" -f db/schema.sql
npm run dev:web                          # http://localhost:3000, login user1 / pass1
npm run dev:worker
```

Each process reads its configuration once at startup and stops with a message naming any missing or malformed variable. `DATABASE_URL` is required, and the worker needs `ANTHROPIC_API_KEY` unless `LLM_CLIENT=stub`; `LOG_LEVEL` (`debug`, `info`, `warn`, `error`), `PIPELINE_RUN_CONCURRENCY` (worker), `CRAWL_PAGE_BUDGET` (worker, and web, which shows it beside a run's page count, so set it on both) and `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` (web) are optional. Logs are one JSON object per line; a run's lines carry its `pipelineRunId`.

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

Every endpoint uses HTTP Basic auth except the live file, which stays public so sites can proxy to it. The web app uses the same login: a signed-out visitor lands on `/login`, and signing in there sets a cookie that lasts 30 days. The default is `user1` / `pass1`. Set `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` on any deployment, because the default is public. The web app keeps that login as a row in `users` (the password hashed) and every site belongs to the user who submitted it: the API lists and serves only the signed-in user's sites. There is no sign-up, so that user is the only one.

Signed in, "API docs" in the header opens Swagger UI at `/api-docs`, where every endpoint can be tried. The OpenAPI 3.1 description it reads is at `/api/openapi.json`, behind the same login.

| Action | Request |
|---|---|
| Submit a site | `POST /api/sites` with `{"url": "https://example.com"}` |
| List your sites | `GET /api/sites` |
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
| List crawled pages and what is ignored | `GET /api/sites/{slug}/pages` |
| Set the ignored pages and paths | `PUT /api/sites/{slug}/pages` with `{"excludedUrls": [], "excludedUrlPrefixes": ["https://example.com/blog"], "keptUrls": []}` |
| Get the live file (no login) | `GET /w/{slug}/llms.txt` |

```sh
# Submit, then poll the run until it finishes.
curl -si -u user1:pass1 localhost:3000/api/sites -H 'content-type: application/json' -d '{"url":"https://example.com"}'
# 202, with {"publicSlug", "pipelineRunId", "runUrl", "llmsTxtUrl"}
curl -s -u user1:pass1 localhost:3000/api/sites/<slug>/runs/<runId>
# {"status": "running", "currentStage": "crawl", "pagesFetchedCount": 12, "versionNumber": null, ...}
```

A run's `status` is `queued`, `running`, `succeeded`, `unchanged` or `failed`. While it is active, the response has a `Retry-After` header. Re-triggering during a run returns that run, and re-triggering within five minutes of the last run answers 429 with `Retry-After`.

Errors are JSON with a message and a stable code, such as `{"error": "This site has no such run.", "code": "run_not_found"}`. The codes are `unauthorized`, `invalid_request`, `invalid_url`, `invalid_version_number`, `site_not_found`, `run_not_found`, `version_not_found`, `run_in_progress`, `run_produced_no_version`, `site_already_exists`, `cooldown_active` and `internal_error`. A user has one site per URL: submitting a URL they already have answers 409 `site_already_exists`, with the existing site's `publicSlug` and `siteUrl`.

## Deployment

The app runs on [Railway](https://railway.com) as three services in one project: `web`, `worker` and Postgres. Both app services build the repository's `Dockerfile`, and the `SERVICE_ROLE` variable on each (`web` or `worker`) tells `scripts/start-service.sh` which process to start. A merge to `main` deploys both, from the `deploy` job in `.github/workflows/ci.yml`, after the other jobs pass. It needs the repository secret `RAILWAY_TOKEN`, a Railway project token.

Variables are set on the Railway services, not in the repository: `DATABASE_URL` on both (a reference to the Postgres service), `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD` and `DEMO_SITE_ENABLED` on `web`, and `ANTHROPIC_API_KEY` on `worker`. The login is not the default one. `db/demo-seed.sql` was applied once after the schema and its site was handed to the deployment's user, so the demo workspace is there too.

A deploy replaces the worker while runs may be under way. The old worker takes no new runs and has 10 minutes to finish its own, which needs `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (set to 660) on the `worker` service; Railway otherwise kills it at once and those runs fail.

A deploy does not touch the schema. `db/schema.sql` was applied once to the empty database, so a schema change has to be applied to production by hand before the code that needs it is merged.

## Examples

[`docs/examples`](docs/examples/README.md) holds files generated for real sites of different kinds (documentation, a site rendered in the browser, a shop, a blog, a site not in English). `node scripts/generate-examples.mjs` regenerates them against a running stack.

## Checks

| Command | What it runs |
|---|---|
| `scripts/lint.sh` | ESLint, typecheck, and checks on scripts |
| `scripts/test.sh` | Unit tests (Vitest) and tests for `scripts/` |
| `scripts/validate-schema.sh`, `npm run test:database` | Apply `db/schema.sql` to Postgres and check it against the contracts enums; CI only (`schema` job) |
| `scripts/test-e2e.sh` | End-to-end tests against local fixture sites; in CI, runs inside the pinned Playwright image (`e2e` job). The pipeline and monitor tests run the real worker, and the browser tests (`e2e/tests/browser.test.ts`) drive the web app in headless Chromium through submitting a site and "check now". These need `DATABASE_URL` (the browser tests create and drop a database of their own, so the role must be allowed to create databases) and are skipped locally without it |

The same scripts run locally and in CI. The end-to-end tests listen on loopback ports, so a sandbox that blocks local binding will make them fail.
