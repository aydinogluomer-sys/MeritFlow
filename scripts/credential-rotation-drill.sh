#!/usr/bin/env bash
# =============================================================================
# ENGINEERING-12 — credential rotation drill.
#
# WHAT: A guided checklist that walks an operator through rotating every
#   MeritFlow secret and confirming the OLD key is dead. It reads nothing and
#   writes nothing sensitive: rotation happens in the Supabase Dashboard,
#   Vercel, and GitHub — this script only orchestrates the steps and (in
#   --apply mode) shells out to `gh secret set` / `vercel env add`, which read
#   the new value themselves.
#
# WHEN: on suspected compromise, on operator offboarding, and on a scheduled
#   cadence (>= every 90 days). See docs/runbooks/incident-response.md §4.
#
# ┌───────────────────────────────────────────────────────────────────────┐
# │ MANDATORY WARNING: NEVER log or echo secret values.                    │
# │ This script never reads a secret (no `gh secret get`, no               │
# │ `vercel env pull`), never prints one, and lets the CLIs prompt for and │
# │ consume the new value out of band. Keep it that way (CLAUDE.md /       │
# │ SI-11: service-role & DSN never logged, committed, or client-bundled). │
# └───────────────────────────────────────────────────────────────────────┘
#
# This script does NOT touch the production database. Credential rotation is
# done via Supabase Dashboard / Vercel / GitHub — never a direct DB connection
# (CLAUDE.md / ADR-014).
#
# Modes:
#   credential-rotation-drill.sh            DRY-RUN (default) — print the full
#                                           checklist, take no action, emit an
#                                           evidence row. Exit 0.
#   credential-rotation-drill.sh --apply    Prompt per step (Enter to execute /
#                                           'skip' to skip); run gh/vercel where
#                                           possible; open the Supabase/Sentry
#                                           dashboard for manual rotation. Exit 1
#                                           if any step was skipped.
#
# Guard: refuses to run unless STAGING_CONFIRMED=1 (prevents an accidental prod
# run). House style: no `set -euo pipefail` — run each step, then decide.
# =============================================================================

# --- Safety guard: explicit opt-in only -------------------------------------
if [ -z "${STAGING_CONFIRMED:-}" ]; then
  echo "Set STAGING_CONFIRMED=1 to proceed." >&2
  echo "(This is a staging/drill runbook — never point it at production.)" >&2
  exit 1
fi

MODE="dry-run"
if [ "${1:-}" = "--apply" ]; then MODE="apply"; fi

TOTAL_STEPS=0
ACTED=0
SKIPPED=0
CRED_FLAG=0
CRED_ACTED=()

# --- Helpers ----------------------------------------------------------------

open_url() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  else
    echo "     (open manually) $url"
  fi
}

# do_step <description> <kind: open|gh|vercel|manual> <arg>
#   open   arg = dashboard URL
#   gh     arg = GitHub secret NAME  -> `gh secret set NAME --env production`
#   vercel arg = Vercel env NAME     -> `vercel env rm/add NAME production`
#   manual arg = operator instruction text
# Never echoes a secret value — the CLIs read the new value themselves.
do_step() {
  local desc="$1" kind="$2" arg="$3"
  TOTAL_STEPS=$((TOTAL_STEPS + 1))

  if [ "$MODE" = "dry-run" ]; then
    echo "  [DRY-RUN] $desc"
    case "$kind" in
      open)   echo "            -> would open:  $arg" ;;
      gh)     echo "            -> would run:   gh secret set $arg --env production   (gh prompts for the value; never echoed)" ;;
      vercel) echo "            -> would run:   vercel env rm $arg production --yes && vercel env add $arg production   (vercel prompts for the value; never echoed)" ;;
      manual) echo "            -> operator:    $arg" ;;
    esac
    return 0
  fi

  # --apply: prompt the operator.
  printf '  %s\n  Press Enter to execute, or type '\''skip'\'' to skip: ' "$desc"
  local ans
  IFS= read -r ans
  if [ "$ans" = "skip" ]; then
    echo "  SKIPPED: $desc"
    SKIPPED=$((SKIPPED + 1))
    return 1
  fi

  case "$kind" in
    open)
      echo "  Opening dashboard: $arg"
      open_url "$arg"
      printf '  Press Enter once the rotation is complete in the browser: '
      local _c; IFS= read -r _c
      ;;
    gh)
      # `gh secret set` reads the new value from a hidden prompt / stdin itself.
      # We never see, capture, or echo it. No `gh secret get` anywhere.
      gh secret set "$arg" --env production \
        || echo "  WARN: gh secret set $arg failed (see gh output above)."
      ;;
    vercel)
      # Remove-then-add so the new value replaces the old. `rm` does not print
      # the value; `add` reads the new value from vercel's own prompt.
      vercel env rm "$arg" production --yes >/dev/null 2>&1
      vercel env add "$arg" production \
        || echo "  WARN: vercel env add $arg failed (see vercel output above)."
      ;;
    manual)
      echo "  $arg"
      printf '  Press Enter once done: '
      local _c; IFS= read -r _c
      ;;
  esac

  ACTED=$((ACTED + 1))
  CRED_FLAG=1
  return 0
}

# credential <name>  — print the info header; reset the per-credential flag.
credential() {
  CRED_FLAG=0
  echo ""
  echo "-------------------------------------------------------------------"
  echo "CREDENTIAL: $1"
  echo "-------------------------------------------------------------------"
}

# end_credential <name> — record it as acted-on if any of its steps ran.
end_credential() {
  if [ "$CRED_FLAG" = "1" ]; then CRED_ACTED+=("$1"); fi
}

# --- Banner -----------------------------------------------------------------

echo "==================================================================="
echo " MeritFlow — credential rotation drill   [mode: $MODE]"
echo "==================================================================="
echo "This script does NOT touch the production database. Rotation happens"
echo "via Supabase Dashboard / Vercel / GitHub — never a direct DB connection."
echo "NEVER log or echo secret values. No secret is read by this script."
if [ "$MODE" = "dry-run" ]; then
  echo ""
  echo "DRY-RUN: printing the checklist only. Re-run with --apply to execute."
fi

# Placeholders (never real values): <PROJECT_REF> Supabase project ref,
# <ORG>/<PROJECT> your Sentry org/project slugs.

# --- 1. SUPABASE_SERVICE_ROLE_KEY -------------------------------------------
credential "SUPABASE_SERVICE_ROLE_KEY"
echo "Lives:   local .env.local (dev); Vercel (Production + Preview, server-only)."
echo "         NOT a CI secret — ci.yml uses a dummy 'ci-service-role-key'."
echo "Rotate:  Supabase Dashboard -> Settings -> API -> service_role key ->"
echo "         'Generate new JWT secret' / regenerate. Then update Vercel + .env.local."
echo "Verify:  an admin request with the OLD key returns 401 (PostgREST rejects it)."
do_step "Rotate service_role at source (Supabase Dashboard -> API)" \
  open "https://supabase.com/dashboard/project/<PROJECT_REF>/settings/api"
do_step "Propagate new value to Vercel (Production)" \
  vercel "SUPABASE_SERVICE_ROLE_KEY"
do_step "Update local .env.local by hand (dev only)" \
  manual "Edit .env.local: replace SUPABASE_SERVICE_ROLE_KEY with the new value. Do not commit."
end_credential "SUPABASE_SERVICE_ROLE_KEY"

# --- 2. NEXT_PUBLIC_SUPABASE_ANON_KEY (+ JWT secret) ------------------------
credential "NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "Lives:   local .env.local; Vercel (Production + Preview). Public, but derived"
echo "         from the project JWT secret — rotating the JWT secret rotates it."
echo "Rotate:  Supabase Dashboard -> Settings -> API. NOTE: rotating the JWT secret"
echo "         invalidates live sessions AND changes service_role — do both together"
echo "         in a low-traffic window."
echo "Verify:  a request with the OLD anon key returns 401 after the JWT secret rotates."
do_step "Rotate anon key / JWT secret at source (Supabase Dashboard -> API)" \
  open "https://supabase.com/dashboard/project/<PROJECT_REF>/settings/api"
do_step "Propagate new anon key to Vercel (Production)" \
  vercel "NEXT_PUBLIC_SUPABASE_ANON_KEY"
end_credential "NEXT_PUBLIC_SUPABASE_ANON_KEY"

# --- 3. SUPABASE_DB_PASSWORD (deploy.yml) -----------------------------------
credential "SUPABASE_DB_PASSWORD"
echo "Lives:   GitHub Secret, scoped to the 'production' Environment (deploy.yml)."
echo "Rotate:  Supabase Dashboard -> Settings -> Database -> Reset database password."
echo "         Then update the GitHub production-environment secret + any pooled"
echo "         connection strings."
echo "Verify:  connecting with the OLD password fails auth; a deploy.yml dry-run with"
echo "         the NEW password links + previews successfully."
do_step "Reset the database password at source (Supabase Dashboard -> Database)" \
  open "https://supabase.com/dashboard/project/<PROJECT_REF>/settings/database"
do_step "Update the GitHub 'production' secret SUPABASE_DB_PASSWORD" \
  gh "SUPABASE_DB_PASSWORD"
end_credential "SUPABASE_DB_PASSWORD"

# --- 4. SUPABASE_ACCESS_TOKEN (deploy.yml CLI) ------------------------------
credential "SUPABASE_ACCESS_TOKEN"
echo "Lives:   GitHub Secret, scoped to the 'production' Environment (deploy.yml)."
echo "Rotate:  Supabase account -> Access Tokens -> revoke the old, generate a new one."
echo "Verify:  'supabase projects list' with the OLD token returns 401."
do_step "Revoke + mint a new access token at source (Supabase account tokens)" \
  open "https://supabase.com/dashboard/account/tokens"
do_step "Update the GitHub 'production' secret SUPABASE_ACCESS_TOKEN" \
  gh "SUPABASE_ACCESS_TOKEN"
end_credential "SUPABASE_ACCESS_TOKEN"

# --- 5. SENTRY_DSN (server-only) --------------------------------------------
credential "SENTRY_DSN"
echo "Lives:   local .env.local; Vercel (Production, server-only). SERVER-ONLY —"
echo "         never NEXT_PUBLIC_, never logged, never in the client bundle (SI-11)."
echo "Rotate:  Sentry -> Project Settings -> Client Keys (DSN) -> generate a new key,"
echo "         then deactivate the old one."
echo "Verify:  an event sent to the OLD DSN no longer appears in Sentry Issues."
do_step "Generate a new DSN + deactivate the old (Sentry -> Client Keys)" \
  open "https://<ORG>.sentry.io/settings/projects/<PROJECT>/keys/"
do_step "Propagate new DSN to Vercel (Production, server-only)" \
  vercel "SENTRY_DSN"
end_credential "SENTRY_DSN"

# --- 6. SUPABASE_PROJECT_REF (informational — not a rotatable secret) -------
credential "SUPABASE_PROJECT_REF"
echo "Lives:   GitHub Secret, scoped to the 'production' Environment (deploy.yml)."
echo "Note:    this is a project IDENTIFIER, not a secret credential. It does not"
echo "         rotate; update it only if the Supabase project itself changes."

# --- Evidence summary (both modes) ------------------------------------------
DATE_UTC="$(date -u +%Y-%m-%d)"
OPERATOR="${USER:-operator}"

if [ "$MODE" = "apply" ] && [ "${#CRED_ACTED[@]}" -gt 0 ]; then
  CREDS_FIELD="$(IFS=', '; printf '%s' "${CRED_ACTED[*]}")"
else
  CREDS_FIELD="_pending_"
fi
OLD_DEAD="_pending_"
if [ "$MODE" = "apply" ]; then NOTES="_pending_"; else NOTES="dry-run — no action taken"; fi

echo ""
echo "==================================================================="
echo " Evidence — paste into docs/runbooks/rotation-evidence.md"
echo "==================================================================="
echo "| Date | Operator | Credentials rotated | Old key confirmed dead | Notes |"
echo "| --- | --- | --- | --- | --- |"
echo "| $DATE_UTC | $OPERATOR | $CREDS_FIELD | $OLD_DEAD | $NOTES |"
echo ""
echo "Steps: $TOTAL_STEPS total · acted $ACTED · skipped $SKIPPED"
echo "Reminder: rotation is NOT proven until the OLD key is confirmed dead (Y)."

# --- Exit code --------------------------------------------------------------
if [ "$MODE" = "apply" ] && [ "$SKIPPED" -gt 0 ]; then
  echo "" >&2
  echo "EXIT 1: $SKIPPED step(s) were skipped — rotation drill incomplete." >&2
  exit 1
fi
exit 0
