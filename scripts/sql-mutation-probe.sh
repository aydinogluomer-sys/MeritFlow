#!/usr/bin/env bash
# ENGINEERING-30 — SQL Mutation Probes.
# Injects 10 high-risk mutations into the migration SQL one at a time, applies a fresh DB, runs the
# pgTAP suite, and RESTORES the migration immediately. A mutation that pgTAP still passes = a hole in
# the SQL test suite (SURVIVED = BLOCKER). Nothing is ever committed mutated — an EXIT trap restores
# any leftover backup even if the run dies mid-probe.
#
# Requires: Docker + a running local Supabase (`supabase start`) — the caller boots it. This script
# does its own `supabase db reset` per probe. CI: nightly (.github/workflows/nightly.yml).
# Usage: bash scripts/sql-mutation-probe.sh
set -uo pipefail # NOT -e: failures are handled explicitly and the migration is ALWAYS restored.

MIGRATIONS="supabase/migrations"
REPORT_DIR="reports/sql-mutation"
mkdir -p "$REPORT_DIR"

KILLED=0
SURVIVED=0
ERRORED=0
RESULTS=()

# Safety net — restore any leftover *.orig backup (a mutation left behind if the script is killed).
restore_all() {
  for orig in "$MIGRATIONS"/*.orig; do
    [ -e "$orig" ] || continue
    mv -f "$orig" "${orig%.orig}"
  done
}
trap restore_all EXIT

reset_db() { npx --no-install supabase db reset --local >/dev/null 2>&1; }

# probe <id> <desc> <file> <sed-expression>
probe() {
  local id="$1" desc="$2" file="$3" sed_expr="$4"
  echo ""
  echo "=== ${id} — ${desc} ($(basename "$file")) ==="

  if [ ! -f "$file" ]; then
    echo "  ! ERROR: migration not found: $file" >&2
    ERRORED=$((ERRORED + 1))
    RESULTS+=("{\"id\":\"${id}\",\"result\":\"error-missing-file\"}")
    return
  fi

  cp "$file" "${file}.orig"
  sed -i "$sed_expr" "$file"

  # Pattern-drift guard: if the sed matched nothing, the migration text moved — fail loudly instead
  # of silently reporting a false "killed".
  if diff -q "$file" "${file}.orig" >/dev/null 2>&1; then
    echo "  ! ERROR: mutation matched nothing (pattern drift) — update the ${id} sed expression" >&2
    mv -f "${file}.orig" "$file"
    ERRORED=$((ERRORED + 1))
    RESULTS+=("{\"id\":\"${id}\",\"result\":\"error-no-match\"}")
    return
  fi

  if ! reset_db; then
    echo "  ! ERROR: db reset FAILED on the mutated migration (the mutation broke the schema)" >&2
    mv -f "${file}.orig" "$file"
    ERRORED=$((ERRORED + 1))
    RESULTS+=("{\"id\":\"${id}\",\"result\":\"error-db-reset\"}")
    return
  fi

  # Run pgTAP. Non-zero exit = at least one test failed = the mutant was KILLED (good).
  if npx --no-install supabase test db >"${REPORT_DIR}/pgtap_${id}.log" 2>&1; then
    echo "  ✗ SURVIVED — pgTAP still passed with the guard disabled (WEAK suite — BLOCKER)" >&2
    SURVIVED=$((SURVIVED + 1))
    RESULTS+=("{\"id\":\"${id}\",\"desc\":\"${desc}\",\"result\":\"survived\"}")
  else
    echo "  ✓ KILLED — pgTAP failed as expected"
    KILLED=$((KILLED + 1))
    RESULTS+=("{\"id\":\"${id}\",\"desc\":\"${desc}\",\"result\":\"killed\"}")
  fi

  mv -f "${file}.orig" "$file" # RESTORE (the next probe re-resets against the clean file).
}

# ============================ 10 PROBES ============================
# M1 — remove the tenant predicate from the memberships broad-read policy (opens cross-tenant read).
probe "M1" "tenant predicate remove (memberships RLS)" \
  "${MIGRATIONS}/0007_rls_enable_and_policies.sql" \
  '/create policy memberships_select_org/,/);/ s/organization_id = public.current_org()/true/'

# M2 — eligibility threshold >= 15 -> > 15 (a 15-day employee is wrongly excluded).
probe "M2" "eligibility threshold >= -> >" \
  "${MIGRATIONS}/0012_bonus_components_eligibility.sql" \
  's/check (not eligible or days_active >= 15)/check (not eligible or days_active > 15)/'

# M3 — remove the per-row cap guard (allows payouts above the cap).
probe "M3" "payout cap guard remove" \
  "${MIGRATIONS}/0021_bonus_engine.sql" \
  's/else least(cap_minor, raw_share_minor) end;/else raw_share_minor end;/'

# M4 — comment the idempotency unique constraint (a second run with the same key is accepted).
probe "M4" "idempotency unique remove" \
  "${MIGRATIONS}/0013_bonus_calc_runs_allocations_snapshots.sql" \
  '/constraint bonus_calculation_runs_idem_uq unique/ s/^/-- /'

# M5 — comment the double-entry balance constraint trigger (unbalanced ledger accepted).
probe "M5" "ledger balance trigger disable" \
  "${MIGRATIONS}/0014_bonus_ledger.sql" \
  '/create constraint trigger trg_bonus_ledger_balance/,/enforce_bonus_ledger_balance();/ s/^/-- /'

# M6 — turn the AD6 export-block RAISE EXCEPTION into a RAISE NOTICE (guard no longer aborts).
probe "M6" "missing-cap export gate bypass" \
  "${MIGRATIONS}/0018_exports.sql" \
  '/export blocked/ s/raise exception/raise notice/'

# M7 — turn the self-approval RAISE EXCEPTION into a RAISE NOTICE (self-approval no longer blocked).
probe "M7" "self-approval guard remove" \
  "${MIGRATIONS}/0019_tasks_events_reviews.sql" \
  '/self-approval is not permitted/ s/raise exception/raise notice/'

# M8 — turn the illegal-period-transition RAISE EXCEPTION into a RAISE NOTICE (any transition allowed).
probe "M8" "illegal period transition allowed" \
  "${MIGRATIONS}/0011_bonus_periods_pools.sql" \
  '/invalid bonus_period transition/ s/raise exception/raise notice/'

# M9 — flip the largest-remainder tie-break (employee_id asc -> desc): the wrong employee gets +1.
probe "M9" "tie-break asc -> desc" \
  "${MIGRATIONS}/0021_bonus_engine.sql" \
  's/order by frac desc, employee_id asc/order by frac desc, employee_id desc/'

# M10 — comment the snapshot append-only trigger (immutable snapshots become UPDATE-able).
probe "M10" "snapshot immutability remove" \
  "${MIGRATIONS}/0013_bonus_calc_runs_allocations_snapshots.sql" \
  '/create trigger trg_bonus_allocation_snapshots_append_only/,/prevent_mutation();/ s/^/-- /'

# ============================ SUMMARY ============================
echo ""
echo "==================================="
echo "SQL Mutation Probe Summary"
echo "  Killed:   ${KILLED} / 10"
echo "  Survived: ${SURVIVED} / 10"
echo "  Errored:  ${ERRORED} / 10"
echo "==================================="

{
  echo "{"
  echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"killed\": ${KILLED},"
  echo "  \"survived\": ${SURVIVED},"
  echo "  \"errored\": ${ERRORED},"
  echo "  \"results\": [$(
    IFS=,
    echo "${RESULTS[*]}"
  )]"
  echo "}"
} >"${REPORT_DIR}/report.json"
echo "Report written to ${REPORT_DIR}/report.json"

if [ "${SURVIVED}" -gt 0 ] || [ "${ERRORED}" -gt 0 ]; then
  echo "BLOCKER: ${SURVIVED} survived, ${ERRORED} errored — strengthen the pgTAP suite (or fix a drifted probe)." >&2
  exit 1
fi
echo "All ${KILLED} mutants killed — the SQL test suite is strong."
