#!/usr/bin/env bash
# Starts the web app or the worker from the one image, chosen by SERVICE_ROLE. It is the
# image's default command, so a host that cannot set a command per service (Railway)
# sets the variable instead. docker-compose.yml gives its own commands.
set -euo pipefail

cd "$(dirname "$0")/.."

case "${SERVICE_ROLE:-}" in
  web)
    cd apps/web
    exec ../../node_modules/.bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
    ;;
  worker)
    cd apps/worker
    exec ../../node_modules/.bin/tsx src/main.ts
    ;;
  *)
    echo "start-service: SERVICE_ROLE must be web or worker, got '${SERVICE_ROLE:-}'" >&2
    exit 64
    ;;
esac
