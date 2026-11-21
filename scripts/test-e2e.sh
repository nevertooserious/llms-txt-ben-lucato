#!/usr/bin/env bash
# End-to-end tests: real HTTP against the local fixture sites in e2e/fixture-sites.
# Run locally and in CI (job `e2e`, inside the official Playwright image so the browser
# and its system libraries are pinned). Needs `npm ci` first, and permission to listen
# on loopback ports. The monitor's test (e2e/tests/monitor.test.ts) also needs
# DATABASE_URL pointing at a database with db/schema.sql applied; without it, that test
# is skipped locally and fails in CI.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run test:e2e
