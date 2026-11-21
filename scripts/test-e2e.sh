#!/usr/bin/env bash
# End-to-end tests: real HTTP against the local fixture sites in e2e/fixture-sites.
# Run locally and in CI (job `e2e`, inside the official Playwright image so the browser
# and its system libraries are pinned). Needs `npm ci` first, and permission to listen
# on loopback ports.
#
# The pipeline tests (e2e/tests/site-flavours.test.ts) run the real worker and need
# DATABASE_URL pointing at an empty database with db/schema.sql applied. Without it they
# are skipped locally; in CI (CI is set) a missing DATABASE_URL fails the run.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run test:e2e
