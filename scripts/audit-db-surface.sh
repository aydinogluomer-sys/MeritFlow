#!/usr/bin/env bash
# ENGINEERING-22 (§11) — static DB-surface manifest audit (no Docker).
# Extracts the live surface (public tables, views, SECURITY DEFINER functions) from the migration
# files and fails if any item is NOT classified in security/db-surface.yml. New surface must be
# recorded in the manifest before it can merge — this gate blocks otherwise, forcing a deliberate
# classification (financial_class / grants / category) of every new table/view/definer function.
#
# Complements scripts/audit-security-definer.sh (which queries the LIVE DB in the `db` CI job): this
# gate is purely STATIC (reads .sql files) and runs in the migration-lint job — no Docker.
#
# Usage:   bash scripts/audit-db-surface.sh [migrations_dir] [surface_file] [allowlist_file]
# Selftest (false-green proof — mirrors scripts/perf-selftest.sh):
#   DB_SURFACE_AUDIT_SELFTEST=1 bash scripts/audit-db-surface.sh
#     → injects a phantom, UNCLASSIFIED table into the candidate set and asserts the audit REPORTS
#       it (errors >= 1). If the audit stays silent the gate would be a false-green → selftest exits
#       1. The manifest file is never modified (the phantom is injected in-memory, per spec).
set -uo pipefail

MIGRATIONS_DIR="${1:-supabase/migrations}"
SURFACE_FILE="${2:-security/db-surface.yml}"
ALLOWLIST="${3:-security/security-definer-allowlist.txt}"

errors=0

# A surface item is "classified" when a 2-space-indented `  <name>:` key exists in the manifest.
is_classified() {
  grep -qE "^  ${1}:" "$SURFACE_FILE" 2>/dev/null
}

# Audit the extracted surface against the manifest. $1 = optional extra (phantom) table candidates,
# space-separated, used only by the selftest. Accumulates into the global `errors`.
audit_surface() {
  local extra_tables="${1:-}"

  # Tables — precise `create table [if not exists] public.NAME` (\K resets match start; \bview\b is
  # deliberately NOT reused for tables). Avoids the naive `public.\w+` grabbing FK-referenced names.
  local tables
  tables=$(grep -rihoP 'create\s+table\s+(if\s+not\s+exists\s+)?public\.\K\w+' "$MIGRATIONS_DIR"/*.sql | sort -u)
  for tbl in $tables $extra_tables; do
    if ! is_classified "$tbl"; then
      echo "::error::DB surface UNCLASSIFIED table: public.$tbl (add to $SURFACE_FILE)"
      errors=$((errors + 1))
    fi
  done

  # Views — precise `create [or replace] view public.NAME`. (A naive `.*view.*` matches inside the
  # word "re-view", so "task_reviews"/"disputes" would be false view hits — hence the tight pattern.)
  local views
  views=$(grep -rihoP 'create\s+(or\s+replace\s+)?view\s+public\.\K\w+' "$MIGRATIONS_DIR"/*.sql | sort -u)
  for vw in $views; do
    if ! is_classified "$vw"; then
      echo "::error::DB surface UNCLASSIFIED view: public.$vw (add to $SURFACE_FILE)"
      errors=$((errors + 1))
    fi
  done

  # SECURITY DEFINER functions — reuse the existing reviewed allowlist as the source of truth. Every
  # allowlisted function must ALSO be classified (category + notes) in the manifest.
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue      # skip comments
    [[ -z "${line//[[:space:]]/}" ]] && continue     # skip blank lines
    local func="${line//[[:space:]]/}"               # schema.function, e.g. public.current_org
    if ! grep -qE "^  ${func}:" "$SURFACE_FILE" 2>/dev/null; then
      echo "::error::SECURITY DEFINER unclassified in surface: $func (add to $SURFACE_FILE)"
      errors=$((errors + 1))
    fi
  done < "$ALLOWLIST"
}

# ---- Selftest (false-green guard): a phantom table MUST be reported unclassified ----
if [ "${DB_SURFACE_AUDIT_SELFTEST:-0}" = "1" ]; then
  audit_surface "phantom_unclassified_table_zzz" >/dev/null 2>&1
  if [ "$errors" -ge 1 ]; then
    echo "db-surface selftest: PASSED (audit flagged the injected phantom table — gate is live)"
    exit 0
  fi
  echo "db-surface selftest: FAILED — audit did NOT flag an unclassified table (gate is a false-green)" >&2
  exit 1
fi

# ---- Normal audit ----
audit_surface ""
if [ "$errors" -gt 0 ]; then
  echo "audit-db-surface: $errors unclassified surface item(s) — update $SURFACE_FILE" >&2
  exit 1
fi
echo "audit-db-surface: OK (all tables/views/functions classified in $SURFACE_FILE)"
