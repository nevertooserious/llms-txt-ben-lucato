# llms.txt generator

A web app that takes a website URL, generates an [llms.txt](https://llmstxt.org) for it, and keeps it up to date as the site changes. The design is in [`docs/design/README.md`](docs/design/README.md).

Status: the extractor, the crawler, the run lifecycle (submission, queueing, reaper, monitor tick), the run itself (crawl, extract, reconcile, publish), the generator and monitoring (on from submission, scheduled checks, "check now") are implemented. So is the UI for generating a file (submit a URL, watch the run, preview, copy, download, the hosted URL) for monitoring ("check now"), for choosing which version is live, and for deleting a site. With `ANTHROPIC_API_KEY` set, Claude Haiku assesses each candidate page (description, whether it belongs, page type) and Claude Opus writes the site summary. These calls have not yet run against the live API. Without a key the worker uses heuristics, which is meant only for local development and tests.

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

## Quick start with Docker

```sh
docker compose up --build                # http://localhost:3000
```

This starts Postgres (with `db/schema.sql` applied on first boot), the web app and the worker. No configuration is needed. To use Claude rather than heuristics, put `ANTHROPIC_API_KEY` in a `.env` file at the repository root and run the command again. `WEB_PORT` (default 3000) and `POSTGRES_PORT` (default 5433) change the host ports.

The schema is applied only to an empty database, so after changing it run `docker compose down --volumes`, which deletes all local data. The crawler's SSRF guard refuses private addresses, so this stack cannot crawl a site running on your machine.

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

The spec puts the file at `/llms.txt` on your site. Each workspace has a stable hosted URL, `https://<app>/w/<slug>/llms.txt`, shown on its page, which serves the latest version unless you pin another on that page. Point your own path at it with a proxy, which keeps your domain in the response, or a redirect.

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

## Checks

| Command | What it runs |
|---|---|
| `scripts/lint.sh` | ESLint, typecheck, and checks on diagrams and scripts |
| `scripts/test.sh` | Unit tests (Vitest) and tests for `scripts/` |
| `scripts/validate-schema.sh`, `npm run test:database` | Apply `db/schema.sql` to Postgres and check it against the contracts enums; CI only (`schema` job) |
| `scripts/test-e2e.sh` | End-to-end tests against local fixture sites; in CI, runs inside the pinned Playwright image (`e2e` job). The pipeline and monitor tests run the real worker, and the browser tests (`e2e/tests/browser.test.ts`) drive the web app in headless Chromium through submitting a site and "check now". These need `DATABASE_URL` (the browser tests create and drop a database of their own, so the role must be allowed to create databases) and are skipped locally without it |

The same scripts run locally and in CI. The end-to-end tests listen on loopback ports, so a sandbox that blocks local binding will make them fail.
