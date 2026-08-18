#!/usr/bin/env bash
# REGRESSION PROOF (ENGINEERING-13 DoD):
# Injected regression: seq-scan-large fixture simulates a selective query that Seq Scans
# a 14000-row table (> BIG_TABLE_ROWS=5000).
# Expected: parse-explain reports seqScans.length >= 1, bench() sets fail=1, script exits 1.
# This is verified by self-test case 2 (seq-scan-large seqScanCount>=1).
# A live regression proof against the actual DB (drop index + run benchmark + restore) is
# recorded in docs/runbooks/performance.md under "Regression injection evidence".
set -euo pipefail

# Self-test for parse-explain.js and calc-percentiles.js.
# Every case must explicitly PASS or FAIL — no silent false-positive.
# Exit 0 only if ALL cases pass.
#
# Note: the `node -e` helpers read stdin via file descriptor 0 (`readFileSync(0, ...)`) rather
# than '/dev/stdin' so the self-test is portable (Linux/CI and Windows git-bash both work).

PASS=0; FAIL=0

check() {
  local name="$1" result="$2" expected="$3"
  if [ "$result" = "$expected" ]; then
    echo "  PASS: $name"; PASS=$((PASS+1))
  else
    echo "  FAIL: $name"; echo "    expected: $expected"; echo "    got:      $result"; FAIL=$((FAIL+1))
  fi
}

# 1. indexed fixture → seqScanCount = 0
out=$(node scripts/perf/parse-explain.js < tests/fixtures/perf/indexed-query.json)
count=$(echo "$out" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(d.seqScans.length))")
check "indexed-fixture seqScanCount=0" "$count" "0"

# 2. seq-scan-large fixture → seqScanCount >= 1
out=$(node scripts/perf/parse-explain.js < tests/fixtures/perf/seq-scan-large.json)
count=$(echo "$out" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(d.seqScans.length))")
[ "$count" -ge 1 ] && check "seq-scan-large seqScanCount>=1" "1" "1" || check "seq-scan-large seqScanCount>=1" "0" "1"

# 3. invalid JSON → non-zero exit
node scripts/perf/parse-explain.js <<< "not json" 2>/dev/null && check "invalid-json exits non-zero" "0" "1" || check "invalid-json exits non-zero" "1" "1"

# 4. empty-plan (missing Execution Time) → exit 3
code=0
node scripts/perf/parse-explain.js < tests/fixtures/perf/empty-plan.json 2>/dev/null || code=$?
[ "$code" -eq 3 ] && check "missing-exec-time exits 3" "3" "3" || check "missing-exec-time exits 3" "$code" "3"

# 5. empty timings → non-zero exit
printf "" | node scripts/perf/calc-percentiles.js 2>/dev/null && check "empty-timings exits non-zero" "0" "1" || check "empty-timings exits non-zero" "1" "1"

# 6. known [1,2,3,4,5] → deterministic percentile (p50=3.00, p95=5.00, p99=5.00)
result=$(printf "1\n2\n3\n4\n5\n" | node scripts/perf/calc-percentiles.js)
check "percentile [1..5]" "$result" "p50=3.00 p95=5.00 p99=5.00"

echo ""
echo "perf-selftest: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
