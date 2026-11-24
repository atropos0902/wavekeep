#!/usr/bin/env bash
# Starts everything: Postgres, migrations, synthetic data, API, worker and web app.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT_DB=${PORT_DB:-5461}
export OWNER_URL="postgres://postgres:owner@127.0.0.1:$PORT_DB/postgres"
export DATABASE_URL="postgres://wavekeep_app:app@127.0.0.1:$PORT_DB/postgres"
command -v pnpm >/dev/null || { echo "pnpm 10 is needed"; exit 1; }
[ -d node_modules ] || pnpm install --frozen-lockfile
docker start wavekeep-demo >/dev/null 2>&1 || docker run -d --name wavekeep-demo -e POSTGRES_PASSWORD=owner -p "127.0.0.1:$PORT_DB:5432" postgres:18.3 >/dev/null
until docker exec wavekeep-demo psql -h 127.0.0.1 -U postgres -c 'select 1' >/dev/null 2>&1; do sleep 0.5; done
node scripts/setup-db.ts
[ -d apps/web/.next/server ] || pnpm --filter @wavekeep/web build
trap 'kill 0' EXIT
node apps/api/src/server.ts &
node apps/worker/src/main.ts &
(cd apps/web && exec pnpm exec next start -p 4310 -H 127.0.0.1) &
echo "web on http://127.0.0.1:4310, sign in with owner@northlight.example and the password demo"
wait
