#!/usr/bin/env bash
# Tests for the repository's own scripts. Run locally, by the no-mistakes gate, and in CI.
set -euo pipefail

cd "$(dirname "$0")/.."

python3 -m unittest discover --start-directory scripts --pattern '*_test.py'
