#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate. Single entrypoint for all 17 checks (the whole 9.5
# hardening program). Runs the no-Docker gates, then boots ONE Supabase session shared by the
# DB/concurrency/perf/E2E gates (SUPABASE_RUNNING=1 so each sub-script skips its own start/stop),
# collecting evidence under artifacts/engineering-evidence/. First failure stops the run (set -e).
# Requires Docker. Usage: bash scripts/verify-engineering.sh   OR   npm run verify:engineering
set -euo pipefail

EVIDENCE="artifacts/engineering-evidence"
mkdir -p "$EVIDENCE"

echo "=== verify:engineering — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
git rev-parse HEAD >"$EVIDENCE/commit.txt"
echo "Commit: $(cat "$EVIDENCE/commit.txt")"
echo ""

# ── No-Docker gates ──────────────────────────────────────────────────────────
bash scripts/verify-fast.sh
bash scripts/verify-security.sh
bash scripts/verify-contracts.sh

# ── Docker gates (one shared Supabase session) ───────────────────────────────
echo ""
echo "=== Starting Supabase (shared session) ==="
npx --no-install supabase start
# Stop Supabase on ANY exit (success or a sub-script failure) so nothing leaks.
trap 'npx --no-install supabase stop || true' EXIT
export SUPABASE_RUNNING=1

bash scripts/verify-db.sh
bash scripts/verify-concurrency.sh
bash scripts/verify-perf.sh
bash scripts/verify-e2e-golden.sh

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "==================================="
echo "verify:engineering PASSED — all 17 steps green"
echo "Commit:   $(cat "$EVIDENCE/commit.txt")"
echo "Evidence: $EVIDENCE/"
ls -lh "$EVIDENCE/" || true
echo "==================================="
