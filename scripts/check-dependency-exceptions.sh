#!/usr/bin/env bash
# ENGINEERING-19 (8.1) — fail if any dependency-audit exception has expired.
# Parses security/dependency-exceptions.yml with grep/regex (no yq required in CI) and exits 1 if
# any `expires: "YYYY-MM-DD"` is before today. ISO dates sort lexically, so a string < is correct.
set -euo pipefail

FILE="security/dependency-exceptions.yml"
TODAY=$(date +%Y-%m-%d)

if [[ ! -f "$FILE" ]]; then
  echo "ERROR: $FILE not found"
  exit 1
fi

while IFS= read -r line; do
  # Skip comment lines — commented examples are documentation, not live exceptions.
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" =~ expires:[[:space:]]*\"([0-9]{4}-[0-9]{2}-[0-9]{2})\" ]]; then
    expires="${BASH_REMATCH[1]}"
    if [[ "$expires" < "$TODAY" ]]; then
      echo "ERROR: Expired dependency exception (expires=$expires < today=$TODAY)"
      echo "  Line: $line"
      echo "  Remove or renew the exception in $FILE"
      exit 1
    fi
  fi
done < "$FILE"

echo "Dependency exceptions OK (none expired)"
