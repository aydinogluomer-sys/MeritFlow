#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate: concurrency harness (Docker).
# Covers step 10. Mirrors the CI `concurrency-db` job (real multi-session pg races). Runs standalone
# or under verify:engineering (SUPABASE_RUNNING=1). Usage: bash scripts/verify-concurrency.sh
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

echo "=== [10/17] concurrency harness (db reset + races) ==="
db_reset
TEST_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  npm run test:concurrency | tee "$EVIDENCE/concurrency-summary.json"

echo "verify:concurrency OK — evidence in $EVIDENCE/"
