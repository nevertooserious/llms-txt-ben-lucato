# llms.txt generator

A web app that takes a website URL, generates an [llms.txt](https://llmstxt.org) for it, and keeps it up to date as the site changes. The design is in [`docs/design/README.md`](docs/design/README.md).

Status: the extractor, the crawler, the run lifecycle (submission, queueing, reaper, monitor tick), the run itself (crawl, extract, reconcile, publish), the generator and monitoring (turning it on and off per workspace, scheduled checks, "check now") are implemented. So is the UI for generating a file (submit a URL, watch the run, preview, copy, download, the hosted URL) and for monitoring (turn it on and off, "check now"). The generator's LLM calls (site summary, missing descriptions) are not wired in yet, so it uses the heuristic fallbacks.

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

## Setup

Needs Node 24 and Postgres 14 or later.

```sh
npm ci
npx playwright install chromium          # headless browser for the crawler
cp .env.example .env                     # set DATABASE_URL
psql "$DATABASE_URL" -f db/schema.sql
npm run dev:web                          # http://localhost:3000
npm run dev:worker
```

Each process reads its configuration once at startup and stops with a message naming any missing or malformed variable. `DATABASE_URL` is required; `LOG_LEVEL` (`debug`, `info`, `warn`, `error`), `PIPELINE_RUN_CONCURRENCY` and `CRAWL_PAGE_BUDGET` (worker) and `SUBMISSIONS_PER_IP_PER_HOUR` and `TRUSTED_PROXY_HOPS` (web) are optional. Logs are one JSON object per line; a run's lines carry its `pipelineRunId`.

## Serving llms.txt from your own domain

The spec puts the file at `/llms.txt` on your site. Each workspace has a stable hosted URL, `https://<app>/w/<slug>/llms.txt`, shown on its page, which always serves the latest version. Point your own path at it with a proxy, which keeps your domain in the response, or a redirect.

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
