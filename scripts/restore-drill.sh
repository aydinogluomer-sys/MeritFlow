#!/usr/bin/env bash
# ENGINEERING-12 — restore-drill proxy. Local disaster-recovery rehearsal: prove the migration
# stack (and, optionally, a restored logical dump) boots clean and holds its schema + financial
# invariants. This is the LOCAL proxy for the cloud restore drill in
# docs/runbooks/disaster-recovery.md §4 (steps 3/5/6). Requires a local Supabase (Docker) + psql.
# NEVER run against production (ADR-014 / CLAUDE.md).
#
# Modes:
#   restore-drill.sh                  Fresh-stack drill: `supabase db reset` (all migrations + seed)
#                                     → schema-drift (migrations parity) → full pgTAP suite, which
#                                     includes 0030 reconciliation invariants + 0031 migration
#                                     integrity.
#   restore-drill.sh --dump FILE.sql  Restore a logical dump into the local DB, then check schema
#                                     parity + the data-agnostic bonus-ledger double-entry balance
#                                     invariant (Σdebit = Σcredit per transaction). pgTAP is skipped
#                                     (it depends on the test seed, not restored prod data).
#
# Deliberately no `set -euo pipefail` — run each phase, collect results, then decide (house style).

DUMP=""
if [ "$1" = "--dump" ]; then DUMP="$2"; fi

start=$(date +%s)
fail=0

# Resolve the local DB URL (supabase status), with the well-known local default as a fallback.
eval "$(npx --no-install supabase status -o env 2>/dev/null | grep '^DB_URL=')"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

if [ -n "$DUMP" ]; then
  echo "== restore-drill: dump restore (${DUMP}) =="
  if [ ! -f "$DUMP" ]; then echo "DRILL: FAILED — dump file not found: $DUMP" >&2; exit 1; fi
  echo "-- restoring dump into the local DB --"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$DUMP" \
    || { echo "DRILL: FAILED — dump restore errored" >&2; exit 1; }
else
  echo "== restore-drill: fresh-stack =="
  echo "-- db reset (all migrations + seed) --"
  npx --no-install supabase db reset \
    || { echo "DRILL: FAILED — db reset errored" >&2; exit 1; }
fi

echo "-- schema drift check (restored schema vs committed migrations) --"
DRIFT=$(npx --no-install supabase db diff 2>/dev/null || true)
if [ -n "$(printf '%s' "$DRIFT" | tr -d '[:space:]')" ]; then
  echo "DRIFT: restored schema differs from committed migrations:" >&2
  printf '%s\n' "$DRIFT" >&2
  fail=1
else
  echo "drift: OK (schema matches migrations)"
fi

if [ -n "$DUMP" ]; then
  echo "-- reconciliation: bonus_ledger double-entry balance (Σdebit = Σcredit per transaction) --"
  IMBAL=$(psql "$DB_URL" -tAqc "select count(*) from (select transaction_id from public.bonus_ledger group by transaction_id having sum(case when entry_type = 'debit' then amount_minor else 0 end) <> sum(case when entry_type = 'credit' then amount_minor else 0 end)) x" 2>/dev/null)
  if [ "${IMBAL:-1}" = "0" ]; then
    echo "ledger balance: OK"
  else
    echo "LEDGER IMBALANCE: ${IMBAL} unbalanced transaction(s) — restore is NOT trustworthy" >&2
    fail=1
  fi
else
  echo "-- pgTAP (reconciliation invariants 0030 + migration integrity 0031 + full suite) --"
  npx --no-install supabase test db || { echo "pgTAP: FAILED" >&2; fail=1; }
fi

rto=$(( $(date +%s) - start ))
echo "== RTO (this drill): ${rto}s =="

if [ "$fail" = "1" ]; then
  echo "DRILL: FAILED — record the failure; do not trust a restore until this is green." >&2
  exit 1
fi
echo "DRILL: OK — record RTO + result in docs/runbooks/disaster-recovery.md §6."
