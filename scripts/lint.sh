#!/usr/bin/env bash
# Repository lint. Run locally and in CI.
#
# Checks:
#   - every diagram in docs/design/diagrams is well-formed standalone SVG (XML)
#   - every shell script in scripts/ parses
#   - every Python script in scripts/ compiles
set -euo pipefail

cd "$(dirname "$0")/.."

status=0

for svg in docs/design/diagrams/*.svg; do
  if ! xmllint --noout "$svg"; then
    echo "lint: $svg is not well-formed XML" >&2
    status=1
  fi
done

for script in scripts/*.sh; do
  if ! bash -n "$script"; then
    echo "lint: $script has a syntax error" >&2
    status=1
  fi
done

for script in scripts/*.py; do
  if ! python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$script"; then
    echo "lint: $script has a syntax error" >&2
    status=1
  fi
done

exit "$status"
