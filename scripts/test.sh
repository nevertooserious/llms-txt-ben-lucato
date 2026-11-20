#!/usr/bin/env bash
# Unit tests. Run locally, by the no-mistakes gate, and in CI. Needs `npm ci` first.
#
# End-to-end tests (npm run test:e2e) are not run here yet.
set -euo pipefail

cd "$(dirname "$0")/.."

python3 -m unittest discover --start-directory scripts --pattern '*_test.py'

npm test
