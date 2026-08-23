#!/usr/bin/env bash
# ENGINEERING-27 — Test Determinism / Flake Budget.
# Runs the critical test scopes repeatedly to surface order/state/timing flakes. A test that only
# fails 1-in-N is a real bug — it is fixed at the root, never masked with a retry.
#
# Usage:
#   bash scripts/test-stability.sh                # unit x20 + concurrency x20 + golden x10
#   bash scripts/test-stability.sh --skip-golden  # unit + concurrency only (golden needs the E2E env)
#
# Requires: npm deps installed. Concurrency needs a reachable Postgres (TEST_DB_URL, or the local
# Supabase at 127.0.0.1:54322). Golden needs the full E2E env (booted Supabase + built app) and ALWAYS
# runs with --retries=0 so a true flake is surfaced (playwright.config's CI retries are infra tolerance
# only — see the comment there). Executable: chmod +x scripts/test-stability.sh (CI runs it via bash).
set -uo pipefail # NOT -e: every run is counted; the final tally decides the exit code.

SKIP_GOLDEN=false
for arg in "$@"; do
  [[ "$arg" == "--skip-golden" ]] && SKIP_GOLDEN=true
done

UNIT_RUNS=20
CONCURRENCY_RUNS=20
GOLDEN_RUNS=10

PASS=0
FAIL=0

# Run a command once; tally pass/fail; NEVER abort the loop (return 0 so `set -e`-free counting works).
run_once() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "  PASS [$label]"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL [$label]" >&2
  fi
  return 0
}

# Unit critical scope — only the paths that exist on this branch. (money.test.ts lands with
# ENGINEERING-25; the existence filter keeps this script correct both before and after that merge.)
UNIT_SCOPE=()
for p in \
  tests/unit/bonus-calculation \
  tests/unit/audit \
  tests/unit/security \
  tests/unit/errors \
  tests/unit/money.test.ts \
  tests/unit/time \
  tests/unit/modules; do
  [[ -e "$p" ]] && UNIT_SCOPE+=("$p")
done

echo "=== Unit critical (x${UNIT_RUNS}) — scope: ${UNIT_SCOPE[*]} ==="
for i in $(seq 1 "$UNIT_RUNS"); do
  run_once "unit #$i" npx vitest run "${UNIT_SCOPE[@]}"
done

echo "=== Concurrency (x${CONCURRENCY_RUNS}) ==="
for i in $(seq 1 "$CONCURRENCY_RUNS"); do
  run_once "concurrency #$i" npx vitest run --config vitest.concurrency.config.ts
done

if [[ "$SKIP_GOLDEN" == "false" ]]; then
  echo "=== Golden E2E (x${GOLDEN_RUNS}, --retries=0) ==="
  for i in $(seq 1 "$GOLDEN_RUNS"); do
    run_once "golden #$i" npx playwright test --project=golden --retries=0
  done
else
  echo "=== Golden E2E skipped (--skip-golden) ==="
fi

echo ""
TOTAL=$((PASS + FAIL))
echo "Results: $PASS passed, $FAIL failed (of $TOTAL runs)"
[[ $FAIL -eq 0 ]] || exit 1
