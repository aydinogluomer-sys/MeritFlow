#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate: performance (Docker for the benchmark).
# Covers steps 11-12. Mirrors the CI `perf-smoke` job. The selftest (11) is Docker-free and runs
# first; the expected-profile benchmark (12) needs a booted, seeded DB. Runs standalone or under
# verify:engineering (SUPABASE_RUNNING=1). Usage: bash scripts/verify-perf.sh
set -euo pipefail

EVIDENCE="artifacts/engineering-evidence"
mkdir -p "$EVIDENCE"

echo "=== [11/17] perf parser selftest (false-green guard; no Docker) ==="
bash scripts/perf-selftest.sh

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

echo "=== [12/17] expected-profile perf benchmark ==="
db_reset
bash scripts/perf-benchmark.sh expected | tee "$EVIDENCE/performance.json"

echo "verify:perf OK — evidence in $EVIDENCE/"
