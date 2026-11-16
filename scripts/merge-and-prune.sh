#!/usr/bin/env bash
#
# Merge a feature branch into master and delete it (local + origin).
# The standing workflow for these repos: work happens on `agent/*`
# branches; every finished task is merged into master with --no-ff and
# the branch is deleted immediately after a successful push. Merged
# branches must never be left behind.
#
# Usage (from the repo root, on a clean worktree):
#   scripts/merge-and-prune.sh <branch> [merge message]
#
# Order is deliberate: merge locally, push master, and only then delete
# the branch (remote, then local). A failed push leaves everything intact
# and exits non-zero. The local delete uses -d (refuses unmerged work);
# the remote delete only runs after master is updated on origin.
set -euo pipefail

BRANCH="${1:-}"
MESSAGE="${2:-Merge ${1:-}: $(git log -1 --format=%s "${1:-}")}"
TARGET="${TARGET:-master}"

[ -n "$BRANCH" ] || { echo "usage: $0 <branch> [merge message]" >&2; exit 2; }
git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null || { echo "no local branch: $BRANCH" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "worktree is not clean" >&2; exit 1; }

git checkout "$TARGET"
git merge --no-ff "$BRANCH" -m "$MESSAGE"
git push origin "$TARGET"
git push origin --delete "$BRANCH" 2>/dev/null || echo "note: no remote branch $BRANCH (nothing to delete)"
git branch -d "$BRANCH"
echo "merged $BRANCH into $TARGET (pushed), branch deleted"
