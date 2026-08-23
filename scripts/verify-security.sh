#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate: security (no Docker).
# Covers step 15 + SBOM. Mirrors the CI `security` job + the build job's SBOM. Writes evidence.
# Usage: bash scripts/verify-security.sh   OR   npm run verify:security
set -euo pipefail

EVIDENCE="artifacts/engineering-evidence"
mkdir -p "$EVIDENCE"

echo "=== [15/17] security (dependency audit + exceptions) ==="
# --json captures the full report to evidence even when high+ vulns fail the audit.
if ! npm audit --audit-level=high --json >"$EVIDENCE/npm-audit.json"; then
  echo "::error::npm audit found high/critical vulnerabilities — see $EVIDENCE/npm-audit.json" >&2
  exit 1
fi
bash scripts/check-dependency-exceptions.sh

echo "=== SBOM (CycloneDX) ==="
npm run sbom
cp artifacts/sbom.cdx.json "$EVIDENCE/sbom.cdx.json"

echo "verify:security OK — evidence in $EVIDENCE/"
