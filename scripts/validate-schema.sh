#!/usr/bin/env bash
# Applies db/schema.sql to an empty Postgres database and fails on the first error.
#
# Usage: DATABASE_URL=postgres://user:pass@host:5432/db scripts/validate-schema.sh
#
# The database must be empty: the schema creates its tables without IF NOT EXISTS.
# CI runs this against a throwaway Postgres 14 service (the oldest version the schema
# targets).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "validate-schema: set DATABASE_URL to an empty Postgres database" >&2
  exit 2
fi

psql "$DATABASE_URL" --no-psqlrc --quiet --set ON_ERROR_STOP=1 --file db/schema.sql
echo "validate-schema: db/schema.sql applied cleanly"
