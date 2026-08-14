#!/usr/bin/env bash
# ENGINEERING-07 — static migration-safety lint (no Docker required).
#
# Runs every check to completion (deliberately NOT `set -euo pipefail`), collecting all
# findings, then exits non-zero if any HARD error was found:
#   Control 1  naming        (hard)  ^NNNN_snake_case.sql$
#   Control 2  ordering       (hard)  contiguous from 0001, no gaps / duplicates
#   Control 3  destructive    (hard)  DROP TABLE / DROP COLUMN / TRUNCATE / RENAME COLUMN
#                                     (temp-table `_scratch` drops and *_seed.sql are exempt)
#   Control 4  unsafe index   (warn)  CREATE INDEX without CONCURRENTLY
#   Control 5  index timeout  (warn)  CONCURRENTLY without a prior statement/lock_timeout
#
# Usage: bash scripts/check-migrations.sh [MIGRATION_DIR]   (default supabase/migrations)

MIGRATION_DIR="${1:-supabase/migrations}"

errors=0
warnings=0

shopt -s nullglob
files=("$MIGRATION_DIR"/[0-9][0-9][0-9][0-9]_*.sql)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
  echo "Migration lint: FAILED — no migration files found in $MIGRATION_DIR" >&2
  exit 1
fi

strip() { sed 's/^[[:space:]]*//' <<<"$1"; }

# ---- Control 1: naming -----------------------------------------------------------------
name_re='^[0-9]{4}_[a-z][a-z0-9_]*\.sql$'
for f in "${files[@]}"; do
  base=$(basename "$f")
  if ! [[ "$base" =~ $name_re ]]; then
    echo "NAMING: $f: must match ^[0-9]{4}_[a-z][a-z0-9_]*\\.sql\$" >&2
    errors=$((errors + 1))
  fi
done

# ---- Control 2: contiguous ordering, no gaps / duplicates ------------------------------
prev=0
declare -A seen
for f in "${files[@]}"; do
  base=$(basename "$f")
  num=$((10#${base:0:4})) # base-10 so 0008/0009 are not read as octal
  if [ -n "${seen[$num]:-}" ]; then
    echo "ORDERING: duplicate migration number $(printf '%04d' "$num") ($f)" >&2
    errors=$((errors + 1))
  fi
  seen[$num]=1
  expected=$((prev + 1))
  if [ "$num" -ne "$expected" ]; then
    echo "ORDERING: expected $(printf '%04d' "$expected") but found $(printf '%04d' "$num") ($f)" >&2
    errors=$((errors + 1))
  fi
  prev=$num
done

# ---- Control 3: destructive ops (HARD) -------------------------------------------------
# Exempt: *_seed.sql (data files) and drops of temp/scratch tables (leading underscore,
# e.g. `_bce_tmp` created + dropped inside engine functions — not a schema-destructive op).
destructive_re='drop[[:space:]]+table|drop[[:space:]]+column|truncate|alter[[:space:]]+table.*rename[[:space:]]+column'
temp_drop_re='drop[[:space:]]+table[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?_'
for f in "${files[@]}"; do
  case "$(basename "$f")" in *_seed.sql) continue ;; esac
  while IFS=: read -r ln content; do
    [ -z "$ln" ] && continue
    if grep -qiE "$temp_drop_re" <<<"$content"; then continue; fi
    echo "DESTRUCTIVE: $f:$ln: $(strip "$content")" >&2
    errors=$((errors + 1))
  done < <(grep -niE "$destructive_re" "$f" | grep -viE '^[0-9]+:[[:space:]]*--')
done

# ---- Control 4: CREATE INDEX without CONCURRENTLY (WARN) --------------------------------
for f in "${files[@]}"; do
  while IFS=: read -r ln content; do
    [ -z "$ln" ] && continue
    if grep -qiE 'concurrently' <<<"$content"; then continue; fi
    echo "INDEX_UNSAFE: $f:$ln: $(strip "$content")" >&2
    warnings=$((warnings + 1))
  done < <(grep -niE 'create[[:space:]]+(unique[[:space:]]+)?index' "$f" | grep -viE '^[0-9]+:[[:space:]]*--')
done

# ---- Control 5: CONCURRENTLY without a prior timeout guard (WARN) -----------------------
for f in "${files[@]}"; do
  if grep -qiE 'create[[:space:]]+(unique[[:space:]]+)?index[[:space:]]+concurrently' "$f"; then
    if ! grep -qiE 'statement_timeout|lock_timeout' "$f"; then
      echo "INDEX_NO_TIMEOUT: $f: CONCURRENTLY index without a prior statement_timeout/lock_timeout" >&2
      warnings=$((warnings + 1))
    fi
  fi
done

# ---- verdict ---------------------------------------------------------------------------
if [ "$errors" -gt 0 ]; then
  echo "Migration lint: FAILED — $errors error(s), $warnings warning(s) — see above" >&2
  exit 1
fi
echo "Migration lint: OK (${#files[@]} files checked)"
[ "$warnings" -gt 0 ] && echo "  ($warnings non-blocking warning(s) — see stderr)"
exit 0
