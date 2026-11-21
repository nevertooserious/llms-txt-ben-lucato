#!/usr/bin/env bash
# End-to-end tests: real HTTP against the local fixture sites in e2e/fixture-sites.
# Run locally and in CI (job `e2e`, inside the official Playwright image so the browser
# and its system libraries are pinned). Needs `npm ci` first, and permission to listen
# on loopback ports. The pipeline and monitor tests (e2e/tests/site-flavours.test.ts,
# e2e/tests/monitor.test.ts) run the real worker and also need DATABASE_URL pointing at
# a database with db/schema.sql applied; without it they are skipped locally and fail
# in CI.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run test:e2e
