# llms.txt generator

A web app that takes a website URL, generates an llms.txt (spec: https://llmstxt.org) and keeps it updated as the site changes. Built as a take-home assignment.

## Current state

Project skeleton: an npm workspaces monorepo with typed stubs for every component; no pipeline logic yet. `README.md` has the layout and setup. Before writing code, read:

- `docs/design/README.md`: the system design, including open questions that are not yet decided.
- `db/schema.sql`: the data model. CI applies it to Postgres 14 on every PR (`scripts/validate-schema.sh`).

Stack (confirmed): TypeScript on Node 24, Next.js for the web app, a Node worker, Playwright for headless rendering, pg-boss for the queue, node-postgres with hand-written SQL, Vitest, ESLint. TypeScript is pinned to 6.0 because typescript-eslint does not support 7 yet.

## Design rules to keep

- **Five components:** crawler, extractor, generator, monitor, frontend. Keep their boundaries.
- **Crawler owns all network I/O.** The extractor is a pure function from HTML to a record and is tested with saved HTML fixtures. `eslint.config.js` enforces both; keep its rules in step if packages change.
- **One writer per column group in `pages`.** A stage writes only its own columns.
- **User edits are inputs, not output edits.** They live in `workspace_page_overrides` and are applied on every render.
- **LLM output is cached against a hash of its inputs.** Never ask the LLM again for unchanged inputs; rewording causes spurious new versions.
- **A page is removed only on its own repeated 404/410,** never because a crawl did not reach it.
- **Every outbound fetch goes through the SSRF guard,** including fetches made by the headless browser.
- **Output conforms to the spec:** H1 and H2 only, one-line entries, an H2 named exactly `Optional`.

## Workflow: PRs, green CI, no-mistakes

`main` is protected: no direct pushes, every change lands through a pull request whose required checks (`lint`, `schema`, `pr-description`) are green.

- **Never commit to or push `main`.** Work on a feature branch, one per change.
- **Ship through no-mistakes.** Commit on the branch, then run `no-mistakes axi run --intent "<the user's goal>"` (the `/no-mistakes` skill describes the loop). It reviews, tests, lints, pushes, opens the PR and watches CI. Do not `git push origin` or `gh pr create` by hand.
- **Merge automatically once green.** When the run reports `checks-passed`, merge the PR yourself without asking: `gh pr merge <number> --merge --delete-branch`. Then tell the user it merged. Never merge with a failing or pending check, never use `--admin`, and never merge a PR the run did not report as `checks-passed`.
- **PR descriptions are at most 500 characters.** Count the text above the no-mistakes appendix (the `<!-- no-mistakes-pr-appendix:v1 ... -->` block, or a `## Pipeline` section in older PRs), excluding HTML comments; the appendix is gate-owned and exempt. CI job `pr-description` enforces it (`scripts/check_pr_description.py`). If a generated description runs over, shorten it with `gh pr edit --body-file`, keeping the appendix byte-for-byte unchanged: its hash is checked.
- **Checks live in `scripts/`.** `scripts/lint.sh` and `scripts/test.sh` run locally and in CI; `scripts/validate-schema.sh` applies `db/schema.sql` to an empty Postgres (CI only, needs `DATABASE_URL`). When adding a check, add it to `.github/workflows/ci.yml`, to `.no-mistakes.yaml` if it can run locally, and to the required checks on `main`.

## Conventions

- **Naming:** descriptive table and column names over short ones (`pipeline_runs` not `runs`, `monitor_check_interval` not `check_interval`). Apply the same to code identifiers.
- **Schema changes:** update `db/schema.sql`, `docs/design/README.md` and `docs/design/diagrams/data-model.svg` together.
- **Diagrams:** hand-written standalone SVG in `docs/design/diagrams/`, fixed light palette on a white background so they read on GitHub in either theme.
- **Scope:** prefer a small, well-understood solution. `docs/design/README.md` section 9 lists what was cut on purpose; do not reintroduce those without asking.

## Confidentiality

Do not copy the assignment brief's text, or the list of reviewer usernames, into the repo.
