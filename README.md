# llms.txt generator

A web app that takes a website URL, generates an [llms.txt](https://llmstxt.org) for it, and keeps it up to date as the site changes. The design is in [`docs/design/README.md`](docs/design/README.md).

Status: project skeleton. Packages have typed interfaces and stub functions; no pipeline logic yet.

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
| `packages/db` | Postgres access; `db/schema.sql` is the schema |
| `e2e` | End-to-end tests against local fixture sites |

ESLint enforces two boundaries: the extractor may not import network, filesystem or database modules, and only the crawler may import network modules.

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

## Checks

| Command | What it runs |
|---|---|
| `scripts/lint.sh` | ESLint, typecheck, and checks on diagrams and scripts |
| `scripts/test.sh` | Unit tests (Vitest) and tests for `scripts/` |
| `npm run test:e2e` | End-to-end tests; not run in CI yet |

The same scripts run in CI and in the no-mistakes gate.
