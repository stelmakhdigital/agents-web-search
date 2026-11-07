#!/usr/bin/env bash
#
# Update the adapter version pins in the core repo READMEs
# (core-web-search/README.md, README.en.md): every
# `agents-web-search.git@vX.Y.Z` becomes `@v<current>`.
#
# Run from the agents-web-search repo root after a version bump:
#   scripts/update-core-readme-pins.sh [path-to-core-repo]
# CI check (no writes; exits 1 when pins are stale):
#   scripts/update-core-readme-pins.sh --check [path-to-core-repo]
#
# The core repo must have a clean README working tree (the script commits
# nothing; review and commit the diff yourself).
set -euo pipefail

CHECK=0
if [ "${1:-}" = "--check" ]; then
  CHECK=1
  shift
fi

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./packages/pi/package.json').version")"
CORE_DIR="${1:-../core-web-search}"
[ -d "$CORE_DIR" ] || { echo "core repo not found: $CORE_DIR" >&2; exit 1; }

STALE=0
for file in "$CORE_DIR/README.md" "$CORE_DIR/README.en.md"; do
  [ -f "$file" ] || continue
  if grep -q "agents-web-search.git@v${VERSION}" "$file"; then
    [ "$CHECK" = 1 ] && echo "pins ok at v${VERSION}: $file"
    continue
  fi
  if [ "$CHECK" = 1 ]; then
    echo "STALE pins (expected v${VERSION}): $file" >&2
    STALE=1
  else
    # Only the install-command pins (agents-web-search.git@vX.Y.Z) are touched.
    sed -i -E "s/(agents-web-search\\.git@)v[0-9]+\\.[0-9]+\\.[0-9]+/\\1v${VERSION}/g" "$file"
    echo "pins updated to v${VERSION}: $file"
  fi
done

if [ "$STALE" = 1 ]; then
  echo "run: scripts/update-core-readme-pins.sh $CORE_DIR" >&2
  exit 1
fi
