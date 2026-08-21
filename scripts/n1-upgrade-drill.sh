#!/usr/bin/env bash
# ENGINEERING-20 (§9B) — N-1 → N migration upgrade proof. Proves that representative data created
# under the N-1 schema SURVIVES applying the latest migration (N), and that the app's financial
# invariants still hold afterward. Requires a running local Supabase (Docker) + psql.
# NEVER run against production (ADR-014 / CLAUDE.md).
#
# MECHANISM (and why it is NOT the literal apply-migrations-upto path):
#   `supabase start` auto-applies EVERY migration, and public.profiles FK-references the
#   Supabase-managed auth.users table — so we cannot hand-apply 0001..N-1 onto a clean/empty DB.
#   Instead we reach the N-1 baseline by stashing migration N and running `supabase db reset`
#   (applies 0001..N-1 + the standard seed), load the N-1 fixture, then apply ONLY migration N on
#   top via psql. Crucially N lands ON TOP of pre-existing N-1 data — the real upgrade path — never
#   a from-scratch reset that would apply N to an empty DB. The reset here only builds the baseline.
#
#   Reconciliation is DATA-AGNOSTIC (double-entry balance + SI-13 pool-sum + fixture survival), not
#   the full pgTAP suite: the pgTAP tests seed their own worked example via run_bonus_calculation
#   and are exercised by the `db` CI job; this drill verifies the SURVIVING data's integrity,
#   mirroring scripts/restore-drill.sh --dump.
#
# INJECTION / FALSE-GREEN PROOF (DoD): running with N1_DRILL_INJECT=1 corrupts migration N AFTER it
# is applied (drops rate_limit_counters.count) so the post-migration schema assertion FAILS and the
# drill exits non-zero — proving a green run is not vacuous. Evidence (record in a PR / runbook):
#   $ N1_DRILL_INJECT=1 bash scripts/n1-upgrade-drill.sh
#   ... "SCHEMA ASSERTION FAILED: migration N did not land intact ..." ; exit code 1
# A normal run (no flag) passes the same assertion. (The literal `ALTER TABLE rate_limit_counters
# DROP COLUMN count` named in the spec is exactly the corruption injected here.)

set -uo pipefail # NOT -e: run each invariant, collect, then decide (house style, like restore-drill.sh)

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
MIGRATIONS_DIR="supabase/migrations"
FIXTURE="supabase/fixtures/n-minus-1.sql"

# N = the highest-numbered migration. Stash it so `supabase db reset` stops at N-1.
LAST_MIGRATION=$(ls "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql | sort | tail -1)
LAST_BASENAME=$(basename "$LAST_MIGRATION")
TOTAL=$(ls "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql | wc -l | tr -d ' ')
STASH_DIR="$(mktemp -d)"
STASHED=""

restore_migration() {
  # Idempotent: only move back if it is currently stashed (out of the migrations dir).
  if [ -n "$STASHED" ] && [ -f "$STASH_DIR/$LAST_BASENAME" ] && [ ! -f "$MIGRATIONS_DIR/$LAST_BASENAME" ]; then
    mv "$STASH_DIR/$LAST_BASENAME" "$MIGRATIONS_DIR/$LAST_BASENAME"
  fi
  rm -rf "$STASH_DIR"
}
trap restore_migration EXIT

fail=0
start=$(date +%s)
echo "=== N-1 upgrade drill: N=$LAST_BASENAME ($TOTAL migrations total) ==="

# 1) Reach the N-1 baseline: stash N, reset (applies 0001..N-1 + seed).
echo "-- stashing $LAST_BASENAME + db reset to the N-1 baseline (0001..N-1 + seed) --"
mv "$MIGRATIONS_DIR/$LAST_BASENAME" "$STASH_DIR/$LAST_BASENAME"
STASHED=1
npx --no-install supabase db reset \
  || { echo "DRILL: FAILED — db reset (N-1 baseline) errored" >&2; exit 1; }

# 2) Load representative N-1 data (distinct-namespace fixture; edge/null cases).
echo "-- loading N-1 fixture: $FIXTURE --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$FIXTURE" \
  || { echo "DRILL: FAILED — N-1 fixture load errored" >&2; exit 1; }

# 3) THE UPGRADE UNDER TEST: restore N and apply it ON TOP of the existing N-1 data.
echo "-- restoring $LAST_BASENAME + applying migration N on top (psql) --"
mv "$STASH_DIR/$LAST_BASENAME" "$MIGRATIONS_DIR/$LAST_BASENAME"
STASHED=""
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATIONS_DIR/$LAST_BASENAME" \
  || { echo "DRILL: FAILED — migration N (upgrade) errored" >&2; exit 1; }

# 3b) Optional false-green injection (DoD): corrupt N so the schema assertion below must fail.
if [ "${N1_DRILL_INJECT:-0}" = "1" ]; then
  echo "-- [inject] dropping rate_limit_counters.count to prove the drill catches a broken migration --"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "alter table public.rate_limit_counters drop column count;" || true
fi

# 4) Post-migration schema assertion: migration N landed intact (its table + columns + RPC exist).
echo "-- post-migration schema assertion (migration N applied cleanly) --"
SCHEMA_OK=$(psql "$DB_URL" -tAqc "
  select case when
    (select count(*) from information_schema.columns
       where table_schema='public' and table_name='rate_limit_counters'
         and column_name in ('key','organization_id','window_start','count')) = 4
    and to_regprocedure('public.check_rate_limit(text,uuid,integer,integer)') is not null
  then 'OK' else 'BROKEN' end")
if [ "$SCHEMA_OK" = "OK" ]; then
  echo "schema assertion: OK"
else
  echo "SCHEMA ASSERTION FAILED: migration N did not land intact (rate_limit_counters/check_rate_limit)" >&2
  fail=1
fi

# 5) Reconciliation — data-agnostic financial invariants over the SURVIVING data (seed + fixture).
echo "-- reconciliation: bonus_ledger double-entry balance (Σdebit = Σcredit per txn) --"
IMBAL=$(psql "$DB_URL" -tAqc "
  select count(*) from (
    select transaction_id from public.bonus_ledger
    group by organization_id, transaction_id
    having sum(case when entry_type='debit'  then amount_minor else 0 end)
        <> sum(case when entry_type='credit' then amount_minor else 0 end)
  ) x")
if [ "${IMBAL:-1}" = "0" ]; then echo "ledger balance: OK"; else
  echo "LEDGER IMBALANCE: ${IMBAL} unbalanced transaction(s) — upgrade is NOT trustworthy" >&2; fail=1; fi

# SI-13 exactly as the reconciliation verifier reads it: Σ(final) + undistributed = pool_ref_minor
# for every completed run whose snapshot declares pool_ref_minor (0030 mirror; robust to t_org).
echo "-- reconciliation: SI-13 Σ(final) + undistributed = pool_ref_minor (completed runs) --"
SI13=$(psql "$DB_URL" -tAqc "
  select count(*) from (
    select r.id
    from public.bonus_calculation_runs r
    join public.bonus_allocation_snapshots s on s.calculation_run_id = r.id
    left join public.bonus_allocations a on a.calculation_run_id = r.id
    where r.status = 'completed'
      and (s.calculation_metadata->>'pool_ref_minor') is not null
    group by r.id, s.undistributed_remainder_minor, (s.calculation_metadata->>'pool_ref_minor')::bigint
    having coalesce(sum(a.final_amount_minor),0) + max(s.undistributed_remainder_minor)
        <> max((s.calculation_metadata->>'pool_ref_minor')::bigint)
  ) x")
if [ "${SI13:-1}" = "0" ]; then echo "SI-13 pool sum: OK"; else
  echo "SI-13 VIOLATION: ${SI13} completed run(s) fail Σfinal + undistributed = pool_ref" >&2; fail=1; fi

# 6) Survival: the N-1 fixture's own tenants still carry their rows after migration N.
echo "-- survival check: N-1 fixture tenants retained their rows post-upgrade --"
SURV=$(psql "$DB_URL" -tAqc "
  select count(*) from public.bonus_periods
  where organization_id in ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002')")
if [ "${SURV:-0}" -ge 2 ]; then echo "fixture survival: OK (${SURV} periods)"; else
  echo "FIXTURE SURVIVAL FAILED: N-1 fixture rows missing after upgrade (${SURV:-0})" >&2; fail=1; fi

rto=$(( $(date +%s) - start ))
echo "=== drill RTO: ${rto}s ==="
if [ "$fail" = "1" ]; then
  echo "N-1 upgrade drill: FAILED — do not trust the upgrade until this is green." >&2
  exit 1
fi
echo "N-1 upgrade drill: PASSED"
