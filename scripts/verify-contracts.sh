#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate: static contracts (no Docker).
# Covers step 6 — migration safety lint + DB-surface manifest audit. Mirrors the CI `migration-lint`
# job (static; no Docker). Usage: bash scripts/verify-contracts.sh   OR   npm run verify:contracts
set -euo pipefail

echo "=== [6/17] migration + DB-surface lint ==="
bash scripts/check-migrations.sh supabase/migrations
bash scripts/audit-db-surface.sh \
  supabase/migrations \
  security/db-surface.yml \
  security/security-definer-allowlist.txt

echo "verify:contracts OK"
