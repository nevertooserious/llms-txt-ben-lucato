# llms.txt generator

A web app that takes a website URL, generates an llms.txt (spec: https://llmstxt.org) and keeps it updated as the site changes. Built as a take-home assignment.

## Current state

Project skeleton: an npm workspaces monorepo with typed stubs for every component. The extractor is implemented and tested against fixtures in `packages/extractor/fixtures/`. The crawler is implemented and tested end to end against local fixture sites in `e2e/fixture-sites/` (`scripts/test-e2e.sh`). The run lifecycle is implemented (URL submission, the run and its job enqueued together, guarded status changes, heartbeat, reaper, monitor tick). So is monitoring: on from submission, with a REST API (HTTP Basic auth, see the README; the web app signs in on `/login`, which sets a signed cookie) to submit, re-run, poll, pin and fetch versions, tested end to end through pg-boss and the worker in `e2e/tests/monitor.test.ts`, and on the real scheduler in `e2e/tests/monitor-cron.test.ts`. The run itself is implemented too: `apps/worker/src/pipeline/run-pipeline-stages.ts` runs the stages in `pipeline/stages/` (load, crawl, generate, publish), each of which loads state, calls a component and the pure decisions in `pipeline/decisions/` and `packages/generator`, and writes the results. The generator selects, renders and validates deterministically, and lists the machine-readable files the crawler finds (the site's `llms-full.txt`, section `llms.txt` files, OpenAPI descriptions). Its LLM step (`apps/worker/src/pipeline/stages/llm-enrichment.ts`) has Haiku assess each candidate page and Opus write the site summary and, where a site needs them, a few notes under it, cached by input hash; it is tested with a fake client and has not yet run against the live API. Without `ANTHROPIC_API_KEY` the worker uses heuristics. The frontend (routes in `apps/web/src/app`, components in `apps/web/src/features`) covers generate, result, monitoring, comparing any two versions, pinning which one is live, and ignoring pages or whole paths (`excluded_url_prefixes`, which also covers pages found later); editing a page's description is not built yet. `e2e/tests/site-flavours.test.ts` runs the real worker end to end against the fixture sites. `e2e/tests/browser.test.ts` drives the web app in headless Chromium through the user flows (submit a site, "check now") against `next dev` and the real worker, in a database it creates and drops. These e2e files need `DATABASE_URL`. `README.md` has the layout and setup. Before writing code, read:

- `docs/design/README.md`: the system design, including open questions that are not yet decided.
- `db/schema.sql`: the data model. CI applies it to Postgres 14 on every PR (`scripts/validate-schema.sh`).

Stack (confirmed): TypeScript on Node 24, Next.js for the web app, a Node worker, Playwright for headless rendering, pg-boss for the queue, node-postgres with hand-written SQL, Vitest, ESLint. TypeScript is pinned to 6.0 because typescript-eslint does not support 7 yet.

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
- **Checks live in `scripts/`.** `scripts/lint.sh` and `scripts/test.sh` run locally and in CI; `scripts/validate-schema.sh` applies `db/schema.sql` to an empty Postgres (CI only, needs `DATABASE_URL`). When adding a check, add it to `.github/workflows/ci.yml` and to the required checks on `main`.

## Conventions

- **Naming:** descriptive table and column names over short ones (`pipeline_runs` not `runs`, `monitor_check_interval` not `check_interval`). Apply the same to code identifiers.
- **Schema changes:** update `db/schema.sql`, `docs/design/README.md` and `docs/design/diagrams/data-model.svg` together.
- **Diagrams:** hand-written standalone SVG in `docs/design/diagrams/`, fixed light palette on a white background so they read on GitHub in either theme.
- **Folders inside a component:** source is grouped by layer, not left flat in `src/` (`README.md`, "Inside a component"). Put a new module in the folder for its layer, export it through the package's `index.ts` only if another package needs it, and keep the layer rules in `eslint.config.js` in step. In `apps/web`, import across folders with the `@/` alias.
- **Scope:** prefer a small, well-understood solution. `docs/design/README.md` section 9 lists what was cut on purpose; do not reintroduce those without asking.

## Confidentiality

Do not copy the assignment brief's text, or the list of reviewer usernames, into the repo.
