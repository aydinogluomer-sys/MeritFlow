#!/usr/bin/env bash
# ENGINEERING-20 (§9B) — apply a PREFIX of the migration stack (0001..N) to a target database.
# A standalone operator utility: given a migration index, it psql-applies every migration whose
# zero-padded numeric prefix is <= that index, in order. Used to stand up an N-1 (or any earlier)
# schema on a CLEAN database (one that already has the Supabase-managed auth schema).
#
# Usage: bash scripts/apply-migrations-upto.sh <migration_index> [db_url]
#   bash scripts/apply-migrations-upto.sh 40
#   SUPABASE_DB_URL=postgresql://... bash scripts/apply-migrations-upto.sh 40
#
# NOTE: the n1-upgrade drill (scripts/n1-upgrade-drill.sh) reaches its N-1 baseline via
# `supabase db reset` with migration N stashed, NOT via this script — because `supabase start`
# auto-applies every migration and public.profiles FK-references auth.users (a Supabase-managed
# table), so hand-applying onto the shared default DB would collide. This utility is for the
# clean-scratch-DB case and for ad-hoc "apply up to K" needs. NEVER run against production.
set -euo pipefail

N=${1:?"Usage: $0 <migration_index> [db_url]"}
DB_URL="${2:-${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
MIGRATIONS_DIR="supabase/migrations"

TARGET=$((10#$N)) # base-10: never let a zero-padded arg be read as octal
count=0
for f in $(ls "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql | sort); do
  prefix=$((10#$(basename "$f" | cut -c1-4))) # base-10 so 0008/0009 aren't octal-parse errors
  if [ "$prefix" -le "$TARGET" ]; then
    echo "-- applying: $(basename "$f")"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
    count=$((count + 1))
  fi
done
echo "Applied $count migration(s) (up to prefix $(printf '%04d' "$TARGET"))."
