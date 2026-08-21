#!/usr/bin/env bash
# ENGINEERING-19 (8.6) — audit every SECURITY DEFINER function in the live Supabase DB.
# Fails if: (1) any such function lacks search_path='' in proconfig (search-path hijack risk), OR
#           (2) any such function is NOT in security/security-definer-allowlist.txt (an un-reviewed
#           privilege escalation). REQUIRES a running Supabase instance (supabase start + db reset)
# and psql — run in CI's `db` job after pgTAP, not locally (Docker may be down).
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ALLOWLIST="security/security-definer-allowlist.txt"
FAIL=0

echo "=== SECURITY DEFINER audit ==="

# All app-owned SECURITY DEFINER functions outside the system / Supabase-managed schemas
# (name|proconfig). Platform-owned helpers such as pgbouncer.get_auth and
# supabase_functions.http_request are not created by this repo and cannot be hardened here.
RESULT=$(psql "$DB_URL" --no-psqlrc -At -c "
  SELECT n.nspname || '.' || p.proname AS fn,
         array_to_string(p.proconfig, ',') AS cfg
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef = true
    AND n.nspname NOT IN (
      'pg_catalog',
      'information_schema',
      'pg_toast',
      'pgbouncer',
      'supabase_functions'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.deptype = 'e'
    )
  ORDER BY n.nspname, p.proname;
")

while IFS='|' read -r fn cfg; do
  [[ -z "$fn" ]] && continue
  # Check 1: search_path must be present and empty.
  if ! echo "$cfg" | grep -q "search_path="; then
    echo "FAIL: $fn — missing search_path in proconfig (=$cfg)"
    FAIL=1
  elif ! echo "$cfg" | grep -qE "search_path=$|search_path=''|search_path=\"\""; then
    echo "WARN: $fn — search_path is set but not empty: $cfg"
  fi
  # Check 2: must be in the allowlist.
  if ! grep -qxF "$fn" "$ALLOWLIST"; then
    echo "FAIL: $fn — NOT in allowlist (unknown SECURITY DEFINER function)"
    FAIL=1
  fi
done <<< "$RESULT"

if [[ $FAIL -eq 1 ]]; then
  echo "=== SECURITY DEFINER audit FAILED ==="
  exit 1
fi
echo "=== SECURITY DEFINER audit PASSED ==="
