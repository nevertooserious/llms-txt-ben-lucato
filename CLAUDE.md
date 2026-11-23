# llms.txt generator

A web app that takes a website URL, generates an llms.txt (spec: https://llmstxt.org) and keeps it updated as the site changes. Built as a take-home assignment.

## Current state

Project skeleton: an npm workspaces monorepo with typed stubs for every component. The extractor is implemented and tested against fixtures in `packages/extractor/fixtures/`. The crawler is implemented and tested end to end against local fixture sites in `e2e/fixture-sites/` (`scripts/test-e2e.sh`). The run lifecycle is implemented (URL submission, the run and its job enqueued together, guarded status changes, heartbeat, reaper, monitor tick). So is monitoring: on from submission, with a REST API (HTTP Basic auth, documented at `/api-docs` in the running app; the web app signs in on `/login`, which sets a signed cookie; the one user is a row in `users`, made from the configured login, and each site belongs to the user who submitted it) to submit, re-run, poll, pin and fetch versions, tested end to end through pg-boss and the worker in `e2e/tests/monitor.test.ts`, and on the real scheduler in `e2e/tests/monitor-cron.test.ts`. The run itself is implemented too: `apps/worker/src/pipeline/run-pipeline-stages.ts` runs the stages in `pipeline/stages/` (load, crawl, generate, publish), each of which loads state, calls a component and the pure decisions in `pipeline/decisions/` and `packages/generator`, and writes the results. The generator selects, renders and validates deterministically, and lists the machine-readable files the crawler finds (the site's `llms-full.txt`, section `llms.txt` files, OpenAPI descriptions). Its LLM step (`apps/worker/src/pipeline/stages/llm-enrichment.ts`) has Haiku assess each candidate page and Opus write the site summary and, where a site needs them, a few notes under it, cached by input hash; it is tested with a fake client. The worker will not start without `ANTHROPIC_API_KEY` unless `LLM_CLIENT=stub`, a client for local development and tests that keeps every page. The frontend (routes in `apps/web/src/app`, components in `apps/web/src/features`) covers generate, result, monitoring, comparing any two versions, pinning which one is live, and ignoring pages or whole paths (`excluded_url_prefixes`, which also covers pages found later); editing a page's description is not built yet. `e2e/tests/site-flavours.test.ts` runs the real worker end to end against the fixture sites. `e2e/tests/browser.test.ts` drives the web app in headless Chromium through the user flows (submit a site, "check now") against `next dev` and the real worker, in a database it creates and drops. These e2e files need `DATABASE_URL`. `README.md` has the setup and the Railway deployment; the layout is below. Before writing code, read:

- `docs/design/README.md`: the system design, as Mermaid diagrams only: the system overview, the pipeline contracts, one each for the crawler, extractor, generator and monitor, and the data model.
- `db/schema.sql`: the data model. CI applies it to Postgres 14 on every PR (`scripts/validate-schema.sh`).

Stack (confirmed): TypeScript on Node 24, Next.js for the web app, a Node worker, Playwright for headless rendering, pg-boss for the queue, node-postgres with hand-written SQL, Vitest, ESLint. TypeScript is pinned to 6.0 because typescript-eslint does not support 7 yet.

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

## Design rules to keep

- **Five components:** crawler, extractor, generator, monitor, frontend. Keep their boundaries.
- **Crawler owns all network I/O.** The extractor is a pure function from HTML to a record and is tested with saved HTML fixtures. `eslint.config.js` enforces both; keep its rules in step if packages change.
- **One writer per column group in `pages`.** A stage writes only its own columns.
- **User edits are inputs, not output edits.** They live in `page_overrides` and `excluded_url_prefixes` and are applied on every render.
- **LLM output is cached against a hash of its inputs.** Never ask the LLM again for unchanged inputs; rewording causes spurious new versions.
- **A page is removed only on its own 404/410,** never because a crawl did not reach it.
- **Every outbound fetch goes through the SSRF guard,** including fetches made by the headless browser.
- **Output conforms to the spec:** H1 and H2 only, one-line entries, an H2 named exactly `Optional`.

## Workflow: PRs and green CI

`main` is protected: no direct pushes, every change lands through a pull request whose required checks (`lint`, `schema`, `pr-description`) are green.

- **Never commit to or push `main`.** Work on a feature branch, one per change.
- **Ship through a PR.** Run `scripts/lint.sh` and `scripts/test.sh`, commit on the branch, push it, and open the PR with `gh pr create`. Watch CI with `gh pr checks <number> --watch`.
- **Merge automatically once green.** When every required check has passed, merge the PR yourself without asking: `gh pr merge <number> --merge --delete-branch`. Then tell the user it merged. Never merge with a failing or pending check, and never use `--admin`.
- **PR descriptions are at most 500 characters.** HTML comments do not count. CI job `pr-description` enforces it (`scripts/check_pr_description.py`). If a description runs over, shorten it with `gh pr edit --body-file`.
- **A merge to `main` deploys.** The `deploy` job in `.github/workflows/ci.yml` pushes the web app and the worker to Railway once the other jobs pass (`README.md`, "Deploying to Railway"). It does not apply schema changes.
- **Checks live in `scripts/`.** `scripts/lint.sh` and `scripts/test.sh` run locally and in CI; `scripts/validate-schema.sh` applies `db/schema.sql` to an empty Postgres (CI only, needs `DATABASE_URL`). When adding a check, add it to `.github/workflows/ci.yml` and to the required checks on `main`.

## Conventions

- **Naming:** descriptive table and column names over short ones (`pipeline_runs` not `runs`, `monitor_check_interval` not `check_interval`). Apply the same to code identifiers.
- **Schema changes:** update `db/schema.sql` and the data model diagram in `docs/design/README.md` together.
- **Diagrams:** Mermaid blocks in `docs/design/README.md`, which GitHub renders, so their text is edited in place. The design doc holds no prose: when a component's behaviour changes, update its diagram.
- **Folders inside a component:** source is grouped by layer, not left flat in `src/` ("Inside a component", above). Put a new module in the folder for its layer, export it through the package's `index.ts` only if another package needs it, and keep the layer rules in `eslint.config.js` in step. In `apps/web`, import across folders with the `@/` alias.
- **Scope:** prefer a small, well-understood solution. Do not add a feature that was not asked for without asking.

## Confidentiality

Do not copy the assignment brief's text, or the list of reviewer usernames, into the repo.
