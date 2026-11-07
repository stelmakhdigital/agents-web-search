#!/usr/bin/env bash
#
# Update the adapter version pins in the core repo READMEs
# (core-web-search/README.md, README.en.md): every
# `agents-web-search.git@vX.Y.Z` becomes `@v<current>`.
#
# Run from the agents-web-search repo root after a version bump:
#   scripts/update-core-readme-pins.sh [path-to-core-repo]
#
# The core repo must have a clean README working tree (the script commits
# nothing; review and commit the diff yourself).
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./packages/pi/package.json').version")"
CORE_DIR="${1:-../core-web-search}"
[ -d "$CORE_DIR" ] || { echo "core repo not found: $CORE_DIR" >&2; exit 1; }

for file in "$CORE_DIR/README.md" "$CORE_DIR/README.en.md"; do
  [ -f "$file" ] || continue
  if grep -q "agents-web-search.git@v${VERSION}" "$file"; then
    echo "pins already at v${VERSION}: $file"
    continue
  fi
  # Only the install-command pins (agents-web-search.git@vX.Y.Z) are touched.
  sed -i -E "s/(agents-web-search\\.git@)v[0-9]+\\.[0-9]+\\.[0-9]+/\\1v${VERSION}/g" "$file"
  echo "pins updated to v${VERSION}: $file"
done
