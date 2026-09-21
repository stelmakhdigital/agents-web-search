/**
 * `@agents-web-search/pi` — Pi (earendil-works) adapter for the agent-agnostic
 * web-search core (`@agents-web-search/core`).
 *
 * A Pi package: this extension registers the core's web stack into the Pi
 * runtime:
 * - all core model-facing tools (in Pi there are NO host-owned web tools, so
 *   the adapter registers `web_search` and `web_fetch` too — ADR-002 §2):
 *   web_search, web_fetch, web_platform_search, web_history, web_search_stats,
 *   web_cache_clear, and — when `browser.enabled` — the `browser_*` tools;
 * - tool results are truncated to the Pi host caps (50KB / 2000 lines);
 * - browser actions are permission-gated through `ctx.ui.confirm`
 *   (fail-closed: no UI ⇒ denied, ADR-005 §3);
 * - the `platforms.enabled` / `history.*` switches filter the registered
 *   tools (parity with dsh-web-automation).
 *
 * All search/fetch/store/platform logic lives in the core; this package only
 * maps host ⇄ core (ADR-002). Everything runs against local state:
 * `<~/.pi/agent>/web-search/web.db` (honors `$PI_CODING_AGENT_DIR`).
 *
 * Config: `~/.pi/agent/web-search.json` (optional; absent ⇒ core defaults).
 * Secrets: process environment (e.g. `EXA_API_KEY`) or `providers.*.apiKey`.
 *
 * Install (git channel, decision 2026-09-21):
 * `pi install https://github.com/stelmakhdigital/agents-web-search.git@v1.0.2`
 * (one command — Pi clones the repo and runs `npm install`); dev:
 * `pi install /path/to/agents-web-search/packages/pi` or copy this dir to
 * `~/.pi/agent/extensions/agents-web-search`.
 *
 * @module @agents-web-search/pi
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { loadPiConfig } from '../src/config.ts'
import { buildPiWebStack } from '../src/host.ts'

export default function extension(pi: ExtensionAPI): void {
  const config = loadPiConfig(getAgentDir())
  // Fail fast on a malformed config before any registration; a config that
  // the core cannot resolve throws here, at startup (visible in the log).
  const { dispose, disposeTools } = buildPiWebStack(pi, config)

  // Long-lived resource cleanup (idempotent; covers session end and /reload):
  // close the store and any browser sessions.
  pi.on('session_shutdown', () => {
    disposeTools()
    void dispose()
  })
}
