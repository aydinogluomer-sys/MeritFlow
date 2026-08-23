#!/usr/bin/env bash
# ENGINEERING-31 — Final Engineering Gate: fast static checks (no Docker).
# Covers steps 1-4 + 16 of the 17-step gate. Mirrors the CI lint/typecheck/unit/architecture jobs.
# Usage: bash scripts/verify-fast.sh   OR   npm run verify:fast
set -euo pipefail

echo "=== [1/17] lint ==="
npm run lint

echo "=== [2/17] typecheck ==="
npm run typecheck

echo "=== [3/17] unit ==="
npm run test

echo "=== [4/17] architecture (circular deps + module boundaries) ==="
npx --no-install madge --circular --ts-config tsconfig.json --extensions ts,tsx src/
node scripts/check-module-manifest.js

echo "=== [16/17] docs / architecture drift ==="
node scripts/check-module-manifest.js

echo "verify:fast OK"
