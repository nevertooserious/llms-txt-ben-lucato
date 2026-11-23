#!/usr/bin/env bash
# Repository lint. Run locally and in CI.
#
# Checks:
#   - every shell script in scripts/ parses
#   - every Python script in scripts/ compiles
#   - ESLint with type information: the strict rule set, the component-boundary import
#     rules and the complexity and size limits in eslint.config.js
#   - no unused files, exports or dependencies (knip, knip.json)
#   - under 1% duplicated code (jscpd, .jscpd.json)
#   - no known vulnerability in a dependency that ships (npm audit)
#   - TypeScript typecheck of every workspace
#   - the Playwright image in CI matches the playwright version in package-lock.json
#
# Needs `npm ci` first.
set -euo pipefail

cd "$(dirname "$0")/.."

status=0

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

if ! npm run --silent lint; then
  echo "lint: eslint failed" >&2
  status=1
fi

if ! npm run --silent lint:dead-code; then
  echo "lint: knip found unused files, exports or dependencies" >&2
  status=1
fi

if ! npm run --silent lint:duplication > /dev/null; then
  echo "lint: duplicated code is over the threshold; run 'npm run lint:duplication' to see it" >&2
  status=1
fi

if ! npm audit --omit=dev --audit-level=high > /dev/null; then
  echo "lint: a dependency has a known vulnerability; run 'npm audit --omit=dev' to see it" >&2
  status=1
fi

if ! npm run --silent typecheck; then
  echo "lint: typecheck failed" >&2
  status=1
fi

installed_playwright=$(node -p "require('./package-lock.json').packages['node_modules/playwright'].version")
if ! grep -q "mcr.microsoft.com/playwright:v${installed_playwright}-" .github/workflows/ci.yml; then
  echo "lint: the Playwright image in .github/workflows/ci.yml does not match playwright ${installed_playwright} in package-lock.json" >&2
  status=1
fi

exit "$status"
