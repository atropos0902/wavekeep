#!/usr/bin/env bash
# Needs DATABASE_URL and OWNER_URL on a seeded database, and a built web app.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
REPLAY_DELAY_MS=300 node apps/worker/src/main.ts >/dev/null &
(cd apps/web && exec pnpm exec next start -p 4310 -H 127.0.0.1 >/dev/null) &
until curl -sf -o /dev/null http://127.0.0.1:4310/sign-in; do sleep 0.5; done
WORKER=1 pnpm exec playwright test "$@"
