#!/usr/bin/env bash
# =============================================================================
# ENGINEERING-12 — data deletion / retention dry-run (STAGING/LOCAL ONLY).
#
# WHAT: A guided, reviewable deletion drill. It enumerates the retention/erasure
#   actions MeritFlow would take (PII soft-delete, ledger retention, audit
#   retention, guarded org hard-delete) and, by default, only PREVIEWS them —
#   printing the SQL that WOULD run plus estimated row counts, changing nothing.
#
# WHEN: as a pre-deletion rehearsal on staging before any real erasure request,
#   and to prove the append-only retention guarantees hold. See
#   docs/runbooks/data-lifecycle.md §5-§7.
#
# ┌───────────────────────────────────────────────────────────────────────┐
# │ Point ledger and bonus ledger are NEVER deleted (CLAUDE.md Decision    │
# │ Lock): corrections are reversal/adjustment entries only. audit_logs,   │
# │ snapshots, dispute/task events are append-only too. This script only   │
# │ COUNTS + WARNS on those — it never emits a DELETE against them.         │
# └───────────────────────────────────────────────────────────────────────┘
#
# LEGAL: KVKK / Türkiye iş hukuku is a legal-review item (Decision Lock D8).
#   Retention periods and any erasure of financial/audit records require legal /
#   HR / finance sign-off. This script is NOT legal advice.
#   *** Consult legal counsel before running --apply on any non-dev database. ***
#
# This script runs ONLY against staging/local DBs. It never infers a target
# from .env.local — the operator must pass TARGET_DB_URL explicitly.
#
# Modes:
#   deletion-dry-run.sh                 DRY-RUN (default): preview steps 1-5, no
#                                       DB changes. Exit 0.
#   deletion-dry-run.sh --apply         Execute steps as ONE transaction
#                                       (ON_ERROR_STOP + --single-transaction):
#                                       any failure rolls back the whole batch.
#   deletion-dry-run.sh --hard-delete-org   Enable the guarded Step 5 (needs
#                                       ORG_ID + CONFIRM_ORG too).
#
# Env:
#   STAGING_CONFIRMED=1   (required)    explicit opt-in, same as the rotation drill.
#   TARGET_DB_URL=<url>   (required)    the DB to target — never production.
#   PRODUCTION_OVERRIDE=yes             required if TARGET_DB_URL looks prod-like.
#   RETENTION_DAYS=<int>  (default 2555 = 7y)  PII/audit retention window.
#   ORG_ID / CONFIRM_ORG                Step 5 org hard-delete (both must match).
#
# Style follows scripts/restore-drill.sh: no `set -euo pipefail` — run each
# phase, collect fail=0/1, decide at the end.
# =============================================================================

# --- Guard 1: explicit staging opt-in ---------------------------------------
if [ -z "${STAGING_CONFIRMED:-}" ]; then
  echo "Set STAGING_CONFIRMED=1 to proceed (staging/local only — never production)." >&2
  exit 1
fi

# --- Guard 2: an explicit target DB URL (never inferred from .env.local) -----
if [ -z "${TARGET_DB_URL:-}" ]; then
  echo "Set TARGET_DB_URL=<postgres url> explicitly. This script never reads a" >&2
  echo "target from .env.local, so production can't be hit by accident." >&2
  exit 1
fi

# --- Guard 3: production-like URL needs a third explicit override ------------
URL_LOWER="$(printf '%s' "$TARGET_DB_URL" | tr '[:upper:]' '[:lower:]')"
PRODISH=0
case "$URL_LOWER" in
  *prod*)         PRODISH=1 ;;   # any 'prod' substring
  *supabase.co*)  PRODISH=1 ;;   # a hosted Supabase project (not local 127.0.0.1)
esac
# Local addresses are explicitly safe (not prod-like).
case "$URL_LOWER" in
  *127.0.0.1*|*localhost*) PRODISH=0 ;;
esac
if [ "$PRODISH" = "1" ]; then
  echo "WARNING: TARGET_DB_URL looks production-like (contains 'prod' or a hosted" >&2
  echo "supabase.co host). This script is for staging/local ONLY (CLAUDE.md/ADR-014)." >&2
  if [ "${PRODUCTION_OVERRIDE:-}" != "yes" ]; then
    echo "Refusing. If you REALLY mean it, set PRODUCTION_OVERRIDE=yes (not recommended)." >&2
    exit 1
  fi
  echo "PRODUCTION_OVERRIDE=yes set — proceeding against a production-like URL." >&2
fi

# --- Retention window (integer days) ----------------------------------------
RETENTION_DAYS="${RETENTION_DAYS:-2555}"
case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "RETENTION_DAYS must be a positive integer (days)." >&2; exit 1 ;;
esac

# --- Mode / flags -----------------------------------------------------------
MODE="dry-run"
HARD_DELETE_ORG=0
for arg in "$@"; do
  case "$arg" in
    --apply)           MODE="apply" ;;
    --hard-delete-org) HARD_DELETE_ORG=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

fail=0
STEPS_RUN=""
COUNTS=""

# Append-only / retention-locked tables — NEVER deleted (enforced by DB triggers
# too: prevent_mutation blocks UPDATE/DELETE). Kept here so Step 5 excludes them.
IMMUTABLE_TABLES="audit_logs point_ledger bonus_ledger bonus_allocation_snapshots dispute_events task_events task_reviews exports"

# --- psql helpers (all read-only + non-fatal; degrade when DB is unreachable) -
HAVE_PSQL=0
command -v psql >/dev/null 2>&1 && HAVE_PSQL=1

psql_scalar() {
  [ "$HAVE_PSQL" = "1" ] || return 1
  psql "$TARGET_DB_URL" -tAqc "$1" 2>/dev/null
}

DB_OK=0
if [ "$HAVE_PSQL" = "1" ]; then
  [ "$(psql_scalar 'select 1')" = "1" ] && DB_OK=1
fi

# col_exists <table> <col> -> yes | no | unknown(no reachable DB)
col_exists() {
  [ "$DB_OK" = "1" ] || { echo "unknown"; return; }
  local r
  r="$(psql_scalar "select 1 from information_schema.columns where table_schema='public' and table_name='$1' and column_name='$2' limit 1")"
  [ "$r" = "1" ] && echo "yes" || echo "no"
}

# count <select-count-sql> -> number | n/a
count() {
  [ "$DB_OK" = "1" ] || { echo "n/a"; return; }
  local r
  r="$(psql_scalar "$1")"
  [ -n "$r" ] && echo "$r" || echo "n/a"
}

# redact a DB URL to host[:port] only (drop credentials + db name) for evidence.
redact_host() {
  local u="$1"
  u="${u#*://}"   # drop scheme://
  u="${u#*@}"     # drop userinfo@
  u="${u%%/*}"    # drop /path
  u="${u%%\?*}"   # drop ?query
  printf '%s' "$u"
}

# --- Banner -----------------------------------------------------------------
echo "==================================================================="
echo " MeritFlow — data deletion / retention dry-run   [mode: $MODE]"
echo "==================================================================="
echo "Target (host only): $(redact_host "$TARGET_DB_URL")"
echo "Retention window:   $RETENTION_DAYS days"
echo "Point/bonus ledger + audit + snapshots are APPEND-ONLY — never deleted."
if [ "$HAVE_PSQL" != "1" ]; then
  echo "NOTE: psql not found — row counts unavailable (checklist prints anyway)."
elif [ "$DB_OK" != "1" ]; then
  echo "NOTE: DB unreachable — printing checklist with counts as n/a (dry-run friendly)."
fi
if [ "$MODE" = "apply" ] && [ "$DB_OK" != "1" ]; then
  echo "ERROR: --apply requires a reachable TARGET_DB_URL (psql could not connect)." >&2
  exit 1
fi

# Statements collected for the single --apply transaction (Steps 2/3/4 add none).
APPLY_SQL=""

# =============================================================================
# Step 1 — Identity soft-delete (PII minimization)
# =============================================================================
echo ""
echo "-- Step 1: identity soft-delete (PII minimization) --------------------"
DELETED_AT="$(col_exists profiles deleted_at)"
if [ "$DELETED_AT" = "yes" ]; then
  # Schema variant WITH a profile-level soft-delete column.
  ACT="$(col_exists profiles last_activity)"
  ACTCOL="updated_at"; [ "$ACT" = "yes" ] && ACTCOL="last_activity"
  S1_SQL="UPDATE public.profiles SET deleted_at = now() WHERE $ACTCOL < now() - make_interval(days => $RETENTION_DAYS) AND deleted_at IS NULL;"
  S1_CNT="$(count "select count(*) from public.profiles where $ACTCOL < now() - make_interval(days => $RETENTION_DAYS) and deleted_at is null")"
  echo "profiles.deleted_at present — soft-delete stale profiles (>$RETENTION_DAYS days, via $ACTCOL)."
else
  # GROUNDED default for the current MeritFlow schema: profiles has NO deleted_at.
  # Soft-delete is membership-level (memberships.status='deactivated'; data-lifecycle §3).
  S1_SQL="UPDATE public.memberships SET status = 'deactivated', deactivated_at = now() WHERE status = 'active' AND updated_at < now() - make_interval(days => $RETENTION_DAYS);"
  S1_CNT="$(count "select count(*) from public.memberships where status='active' and updated_at < now() - make_interval(days => $RETENTION_DAYS)")"
  echo "profiles has no deleted_at column in this schema — soft-delete is MEMBERSHIP-level"
  echo "(memberships.status='deactivated'), which preserves financial/audit rows. (data-lifecycle §3)"
  if [ "$DELETED_AT" = "unknown" ]; then
    echo "(column existence unverified — DB unreachable; showing the schema-accurate form.)"
  fi
fi
echo "  estimated rows affected: $S1_CNT"
echo "  SQL that WOULD run:"
echo "    $S1_SQL"
STEPS_RUN="${STEPS_RUN}1(soft-delete) "
COUNTS="${COUNTS}soft_delete=$S1_CNT "
APPLY_SQL="${APPLY_SQL}\\echo '-- Step 1: identity soft-delete'
$S1_SQL
"

# =============================================================================
# Step 2 — Point ledger: NO DELETE (append-only)
# =============================================================================
echo ""
echo "-- Step 2: point_ledger — NO DELETE ----------------------------------"
echo "Point ledger is append-only per CLAUDE.md Decision Lock. Hard delete requires"
echo "legal basis. No action taken (the DB also blocks DELETE via prevent_mutation)."
PL_CNT="$(count "select count(*) from public.point_ledger")"
echo "  point_ledger rows (awareness only): $PL_CNT"
STEPS_RUN="${STEPS_RUN}2(count) "
COUNTS="${COUNTS}point_ledger=$PL_CNT "

# =============================================================================
# Step 3 — Bonus ledger: NO DELETE (append-only, double-entry money)
# =============================================================================
echo ""
echo "-- Step 3: bonus_ledger — NO DELETE ----------------------------------"
echo "Bonus ledger is append-only, double-entry money per CLAUDE.md Decision Lock."
echo "Corrections are reversal entries only. No action taken (DB blocks DELETE)."
BL_CNT="$(count "select count(*) from public.bonus_ledger")"
echo "  bonus_ledger rows (awareness only): $BL_CNT"
STEPS_RUN="${STEPS_RUN}3(count) "
COUNTS="${COUNTS}bonus_ledger=$BL_CNT "

# =============================================================================
# Step 4 — Audit log: retention check only (never delete)
# =============================================================================
echo ""
echo "-- Step 4: audit_logs — retention check only -------------------------"
AL_OLD="$(count "select count(*) from public.audit_logs where created_at < now() - make_interval(days => $RETENTION_DAYS)")"
AL_OLDEST="$(count "select coalesce(min(created_at)::text,'(none)') from public.audit_logs")"
echo "  audit_logs rows older than $RETENTION_DAYS days: $AL_OLD"
echo "  oldest audit_logs entry: $AL_OLDEST"
echo "Legal/HR/Finance sign-off required before any audit_log deletion."
echo "See legal sign-off checklist in data-lifecycle.md §8. No action taken"
echo "(audit_logs is append-only — DELETE is blocked by prevent_mutation)."
STEPS_RUN="${STEPS_RUN}4(retention) "
COUNTS="${COUNTS}audit_old=$AL_OLD "

# =============================================================================
# Step 5 — Org hard-delete (guarded: ORG_ID + --hard-delete-org + CONFIRM_ORG)
# =============================================================================
echo ""
echo "-- Step 5: org hard-delete (guarded) ---------------------------------"
STEP5_ENABLED=0
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [ -n "${ORG_ID:-}" ] && [ "$HARD_DELETE_ORG" = "1" ] && [ "${CONFIRM_ORG:-}" = "${ORG_ID:-}" ]; then
  if ! printf '%s' "$ORG_ID" | grep -Eq "$UUID_RE"; then
    echo "ORG_ID is not a valid UUID — refusing Step 5."
  else
    STEP5_ENABLED=1
  fi
fi

if [ "$STEP5_ENABLED" != "1" ]; then
  echo "Org hard delete skipped — set ORG_ID, --hard-delete-org, and CONFIRM_ORG=<ORG_ID> to enable."
  STEPS_RUN="${STEPS_RUN}5(skipped) "
else
  echo "Org hard-delete ENABLED for organization_id = $ORG_ID"
  echo "Append-only classes are RETAINED (never deleted): $IMMUTABLE_TABLES"
  echo ""
  echo "Org-scoped tables (organization_id present) and rows for this org:"
  if [ "$DB_OK" = "1" ]; then
    # Discover org-scoped tables from the schema (never hardcoded).
    ORG_TABLES="$(psql_scalar "select table_name from information_schema.columns where table_schema='public' and column_name='organization_id' order by table_name")"
    for t in $ORG_TABLES; do
      c="$(count "select count(*) from public.$t where organization_id = '$ORG_ID'")"
      case " $IMMUTABLE_TABLES " in
        *" $t "*) echo "    $t: $c   [RETAINED — append-only, never deleted]" ;;
        *)        echo "    $t: $c" ;;
      esac
    done
  else
    echo "    (DB unreachable — cannot enumerate org-scoped tables in dry-run.)"
  fi
  echo ""
  echo "Deletion strategy: DELETE FROM public.organizations WHERE id = <ORG_ID>."
  echo "  organization_id FKs are ON DELETE CASCADE, so deletable children are removed"
  echo "  in dependency order by the DB. BUT append-only children (audit_logs, ledgers,"
  echo "  snapshots, *_events) block their own cascade DELETE (prevent_mutation) — so if"
  echo "  the org has any such rows, the transaction ROLLS BACK by design. A real erasure"
  echo "  of those classes is ANONYMIZATION + legal sign-off, not deletion (data-lifecycle §3/§5)."
  echo "  SQL that WOULD run:"
  echo "    DELETE FROM public.organizations WHERE id = '$ORG_ID';"
  STEPS_RUN="${STEPS_RUN}5(org-hard-delete) "
  APPLY_SQL="${APPLY_SQL}\\echo '-- Step 5: org cascade delete (append-only children will abort if present)'
DELETE FROM public.organizations WHERE id = '$ORG_ID';
"
fi

# =============================================================================
# Apply (single transaction) or finish the dry-run
# =============================================================================
if [ "$MODE" = "apply" ]; then
  echo ""
  echo "-- APPLY: executing as a single transaction (rollback on any error) --"
  echo "Consult legal counsel before running --apply on any non-dev database."
  APPLY_OUT="$(printf '%s' "$APPLY_SQL" | psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 --single-transaction 2>&1)"
  APPLY_RC=$?
  echo "$APPLY_OUT"
  if [ "$APPLY_RC" != "0" ]; then
    echo "APPLY FAILED — transaction rolled back (no changes committed)." >&2
    fail=1
  else
    echo "APPLY OK — transaction committed."
  fi
fi

# =============================================================================
# Evidence summary (both modes)
# =============================================================================
DATE_UTC="$(date -u +%Y-%m-%d)"
OPERATOR="${USER:-operator}"
HOST_ONLY="$(redact_host "$TARGET_DB_URL")"
NOTES="profiles has no deleted_at → membership-level soft-delete; ledgers/audit/snapshots never deleted"

echo ""
echo "==================================================================="
echo " Evidence — paste into docs/runbooks/data-lifecycle.md §7"
echo "==================================================================="
echo "| Date | Operator | DB target | Mode | Steps run | Row counts | Notes |"
echo "| --- | --- | --- | --- | --- | --- | --- |"
echo "| $DATE_UTC | $OPERATOR | $HOST_ONLY | $MODE | ${STEPS_RUN% } | ${COUNTS% } | $NOTES |"
echo ""
echo "Reminder: Legal/HR/Finance sign-off (data-lifecycle §8) is required before"
echo "any --apply run against a non-dev DB. This script is not legal advice."

# --- Exit code --------------------------------------------------------------
if [ "$fail" = "1" ]; then
  exit 1
fi
exit 0
