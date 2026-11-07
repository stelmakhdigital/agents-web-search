#!/usr/bin/env bash
#
# Browser-module setup for agents-web-search (Playwright Chromium).
#
# The Pi adapter ships the browser module ENABLED by default; playwright
# (the npm package) installs with the plugin, but the Chromium binary must
# be downloaded once. This script does that download (idempotent: playwright
# skips an already-present build) and can check the status.
#
# Usage:
#   install.sh [install]     default: install (download Chromium for the
#                            playwright version resolved on this host)
#   install.sh status        report playwright/chromium availability
#
# System dependencies (deb/rpm packages for Chromium) may be required on a
# bare host — re-run with --with-deps (needs sudo) when launch fails:
#   npx playwright install --with-deps chromium
set -euo pipefail

MODE="${1:-install}"
log() { echo "browser-install: $*"; }
fail() { echo "browser-install: ERROR: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not found in PATH"; }

# Prefer the playwright version already installed where the core runs
# (the pi git-channel install dir or an extensions dir); fall back to npx.
playwright_cmd() {
  local agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  local candidates=(
    "$agent_dir/git/github.com/stelmakhdigital/agents-web-search/node_modules/.bin/playwright"
    "$agent_dir/extensions/agents-web-search/node_modules/.bin/playwright"
    "$agent_dir/node_modules/.bin/playwright"
  )
  for bin in "${candidates[@]}"; do
    if [ -x "$bin" ]; then
      echo "$bin"
      return
    fi
  done
  echo "npx -y playwright"
}

do_install() {
  need node
  local pw
  pw="$(playwright_cmd)"
  log "using: $pw"
  log "downloading Chromium (skip on re-run when already present)"
  $pw install chromium
  log "done. If a browser launch later complains about missing system packages:"
  log "  npx playwright install --with-deps chromium   (needs sudo)"
  log "Status check: $0 status"
}

do_status() {
  local agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  local probes=(
    "$agent_dir/git/github.com/stelmakhdigital/agents-web-search/node_modules/@agents-web-search/core/lib/index.js"
    "$agent_dir/extensions/agents-web-search/node_modules/@agents-web-search/core/lib/index.js"
  )
  local probe=""
  for candidate in "${probes[@]}"; do
    if [ -f "$candidate" ]; then probe="$candidate"; break; fi
  done
  if [ -n "$probe" ]; then
    local output
    output="$(node --input-type=module -e "
      try {
        const m = await import('$probe')
        if (typeof m.browserReadiness !== 'function') throw new Error('browserReadiness() not exported — adapter too old, run: pi update')
        const r = await m.browserReadiness()
        console.log('playwright:', r.playwright ? 'installed' : 'MISSING')
        console.log('chromium:', r.chromium ? 'downloaded' : 'MISSING')
        if (r.hint) console.log('hint:', r.hint)
        process.exit(r.playwright && r.chromium ? 0 : 1)
      } catch (error) {
        console.log('probe failed:', error instanceof Error ? error.message : String(error))
        process.exit(2)
      }
    " 2>&1)" || true
    echo "$output"
    case "$output" in
      *probe\ failed*) exit 2 ;;
      *MISSING*) exit 1 ;;
    esac
  else
    log "core not found in the known install layouts — run 'status' after installing the pi adapter"
    exit 1
  fi
}

case "$MODE" in
  install) do_install ;;
  status)  do_status ;;
  *) fail "unknown mode '$MODE' (use: install | status)" ;;
esac
