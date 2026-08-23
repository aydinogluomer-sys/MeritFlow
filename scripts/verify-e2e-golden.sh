#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate: build + golden-path E2E (Docker + production build).
# Covers steps 13-14. Mirrors the CI `e2e` job (production build + golden multi-actor chains). Runs
# standalone or under verify:engineering (SUPABASE_RUNNING=1). Usage: bash scripts/verify-e2e-golden.sh
set -euo pipefail

EVIDENCE="artifacts/engineering-evidence"
mkdir -p "$EVIDENCE"

STARTED_HERE=0
if [ "${SUPABASE_RUNNING:-0}" != "1" ]; then
  echo "=== Starting Supabase ==="
  npx --no-install supabase start
  STARTED_HERE=1
fi
cleanup() { [ "$STARTED_HERE" = "1" ] && npx --no-install supabase stop || true; }
trap cleanup EXIT

db_reset() {
  local attempt
  for attempt in 1 2 3; do
    if npx --no-install supabase db reset; then return 0; fi
    npx --no-install supabase stop || true
    npx --no-install supabase start
    sleep 5
  done
  echo "::error::db reset failed after 3 attempts" >&2
  return 1
}

db_reset

# Export the local Supabase keys into the app env (matches the CI e2e job's `supabase status -o env`).
npx --no-install supabase status -o env >/tmp/e31_supabase.env
set -a
# shellcheck disable=SC1091
. /tmp/e31_supabase.env
set +a
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"

echo "=== [13/17] production build ==="
npm run build

echo "=== [14/17] golden-path E2E ==="
# The JSON reporter writes to PLAYWRIGHT_JSON_OUTPUT_NAME; `list` keeps human-readable stdout.
PLAYWRIGHT_JSON_OUTPUT_NAME="$EVIDENCE/e2e-summary.json" \
  npx --no-install playwright test --project=golden --reporter=list,json

echo "verify:e2e:golden OK — evidence in $EVIDENCE/"
