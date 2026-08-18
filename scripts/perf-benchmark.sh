#!/usr/bin/env bash
# ENGINEERING-10 — ICP performance benchmark. Applies the perf dataset at a profile scale, then
# runs EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) on the hot read paths, reporting p50/p95/p99 and
# FAILING on a Seq Scan over a large (>BIG_TABLE_ROWS) table for the SELECTIVE queries only
# (structural regression = a missing/unused index). Full-set aggregates (leaderboard, finance
# views) legitimately scan their whole set — those are report-only. Timing is always report-only
# (CI timing is noisy). Requires a running Supabase (local `supabase start` + `db reset`, or CI)
# and psql + Node.js (for the scripts/perf/ JSON parsers). Deliberately no `set -euo pipefail`
# (run every query, then decide).

PROFILE="${1:-expected}"
case "$PROFILE" in
  expected) SCALE=1000 ;;
  3x)       SCALE=3000 ;;
  10x)      SCALE=10000 ;;
  *) echo "usage: $0 [expected|3x|10x]" >&2; exit 2 ;;
esac

BIG_TABLE_ROWS=5000
REPS=7
ORG='c0000000-0000-0000-0000-000000000003'

# Resolve the local DB URL (supabase status), with the well-known local default as a fallback.
eval "$(npx --no-install supabase status -o env 2>/dev/null | grep '^DB_URL=')"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

echo "== perf profile: ${PROFILE} (scale=${SCALE} rows/table) =="
PGOPTIONS="-c perf.scale=${SCALE}" psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/perf/seed_perf_dataset.sql \
  || { echo "PERF: FAILED — perf seed did not apply" >&2; exit 1; }

Q_LEADERBOARD="select * from public.get_leaderboard('${ORG}'::uuid, null, null)"
Q_TASKS="select * from public.tasks where organization_id='${ORG}' and status='assigned' and assigned_to=(select profile_id from public.memberships where organization_id='${ORG}' limit 1)"
Q_POINTS="select coalesce(sum(points_delta),0) from public.point_ledger where organization_id='${ORG}' and employee_id=(select profile_id from public.memberships where organization_id='${ORG}' limit 1)"
Q_PAYOUT="select * from public.v_finance_payout where bonus_period_id=(select id from public.bonus_periods where organization_id='${ORG}' order by created_at limit 1)"
Q_TOTALS="select * from public.v_finance_period_totals where bonus_period_id=(select id from public.bonus_periods where organization_id='${ORG}' order by created_at limit 1)"

fail=0

# bench <name> <sql> <gate>  — gate=1 → fail on seq-scan-on-large-table; gate=0 → report only.
bench() {
  local name="$1" sql="$2" gate="$3"
  local times=() seq_table="" seq_rows=0 seq_hit=0
  local r plan parsed tmpfile et sh st sr seq_count
  for r in $(seq 1 "$REPS"); do
    plan=$(psql "$DB_URL" -tAqc "explain (analyze, buffers, format json) ${sql}" 2>/dev/null)
    if [ -z "$plan" ]; then echo "  ${name}: EXPLAIN failed"; fail=1; return; fi
    # Parse the EXPLAIN JSON via the dedicated Node parser (no inline heredoc + pipe, which
    # would let the heredoc hijack stdin and always yield et=0). Write the plan to a temp file
    # so the parser reads it as a clean stdin redirect.
    tmpfile=$(mktemp)
    printf '%s' "$plan" > "$tmpfile"
    parsed=$(node scripts/perf/parse-explain.js < "$tmpfile" 2>/dev/null); rm -f "$tmpfile"
    if [ -z "$parsed" ]; then echo "  ${name}: parse-explain failed"; fail=1; return; fi
    et=$(echo "$parsed" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).executionMs))")
    seq_count=$(echo "$parsed" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).seqScans.length))")
    if [ "$seq_count" -gt 0 ]; then
      st=$(echo "$parsed" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.seqScans[0].relation)")
      sr=$(echo "$parsed" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(d.seqScans[0].actualRows))")
      sh=1
    else
      sh=0; st="-"; sr=0
    fi
    times+=("$et")
    if [ "$sh" = "1" ] && [ "${sr:-0}" -gt "$BIG_TABLE_ROWS" ]; then
      seq_hit=1; seq_table="$st"; seq_rows="$sr"
    fi
  done
  local pcts
  pcts=$(printf '%s\n' "${times[@]}" | node scripts/perf/calc-percentiles.js 2>/dev/null)
  if [ -z "$pcts" ]; then echo "  ${name}: percentile calculation failed"; fail=1; return; fi
  p50=$(echo "$pcts" | sed 's/p50=\([^ ]*\).*/\1/')
  p95=$(echo "$pcts" | sed 's/.*p95=\([^ ]*\).*/\1/')
  p99=$(echo "$pcts" | sed 's/.*p99=\([^ ]*\)/\1/')
  local flag="ok"
  if [ "$seq_hit" = "1" ]; then
    if [ "$gate" = "1" ]; then flag="SEQ-SCAN on ${seq_table} (${seq_rows} rows) — REGRESSION"; fail=1;
    else flag="seq-scan on ${seq_table} (${seq_rows}; full-set aggregate — expected)"; fi
  fi
  printf '  %-22s p50=%sms p95=%sms p99=%sms  [%s]\n' "$name" "$p50" "$p95" "$p99" "$flag"
}

echo "== hot query plans (${REPS} reps each) =="
bench "leaderboard"      "$Q_LEADERBOARD" 0
bench "tasks-list"       "$Q_TASKS"       1
bench "point-ledger-sum" "$Q_POINTS"      1
bench "v_finance_payout" "$Q_PAYOUT"      0
bench "v_finance_totals" "$Q_TOTALS"      0

if [ "$fail" = "1" ]; then
  echo "PERF: FAILED — a selective hot query seq-scans a large (>${BIG_TABLE_ROWS} rows) table (missing/unused index)" >&2
  exit 1
fi
echo "PERF: OK (no selective-query seq-scan-on-large-table regression at profile ${PROFILE})"
