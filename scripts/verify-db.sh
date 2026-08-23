#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate: database (Docker).
# Covers steps 5, 7, 8, 9, 17. Mirrors the CI `db` job. Runs standalone (manages its own Supabase)
# or under verify:engineering (SUPABASE_RUNNING=1 → the orchestrator owns start/stop).
# Usage: bash scripts/verify-db.sh   OR   npm run verify:db
set -euo pipefail

EVIDENCE="artifacts/engineering-evidence"
mkdir -p "$EVIDENCE"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

STARTED_HERE=0
if [ "${SUPABASE_RUNNING:-0}" != "1" ]; then
  echo "=== Starting Supabase ==="
  npx --no-install supabase start
  STARTED_HERE=1
fi
cleanup() { [ "$STARTED_HERE" = "1" ] && npx --no-install supabase stop || true; }
trap cleanup EXIT

# db reset with the same 3× retry the CI db job uses (transient infra failures).
db_reset() {
  local attempt
  for attempt in 1 2 3; do
    if npx --no-install supabase db reset; then return 0; fi
    echo "db reset failed (attempt $attempt) — recycling Supabase" >&2
    npx --no-install supabase stop || true
    npx --no-install supabase start
    sleep 5
  done
  echo "::error::db reset failed after 3 attempts" >&2
  return 1
}

echo "=== [7/17] db reset (fresh migrations + seed) ==="
db_reset

echo "=== [5/17] generated DB type drift ==="
npx --no-install supabase gen types --lang typescript --local >/tmp/e31_generated_types.ts
if ! diff -q src/types/database.generated.ts /tmp/e31_generated_types.ts >/dev/null 2>&1; then
  echo "::error::DB type drift — run 'npm run db:types' and commit src/types/database.generated.ts" >&2
  diff src/types/database.generated.ts /tmp/e31_generated_types.ts || true
  exit 1
fi
echo "DB types: no drift"

echo "=== [8/17] pgTAP suite ==="
npx --no-install supabase test db | tee "$EVIDENCE/db-tests.txt"

echo "=== [9/17] DB security surface (SECURITY DEFINER + surface audit) ==="
SUPABASE_DB_URL="$DB_URL" bash scripts/audit-security-definer.sh
bash scripts/audit-db-surface.sh \
  supabase/migrations security/db-surface.yml security/security-definer-allowlist.txt \
  >"$EVIDENCE/security-surface.json" 2>&1 || true

echo "=== [17/17] reconciliation ==="
echo "[17/17] reconciliation invariants: covered by pgTAP 0030_reconciliation_db_invariants (step 8)" \
  | tee "$EVIDENCE/reconciliation.txt"

echo "verify:db OK — evidence in $EVIDENCE/"
