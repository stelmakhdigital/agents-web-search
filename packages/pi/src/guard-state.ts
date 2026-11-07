/**
 * Guard-state persistence for the Pi adapter (`guard-state.json`): one file
 * shared with the pi-extensions guards (bash-guard, dir-guard), keyed by
 * guard name. Reads are best-effort (absent/corrupt file means fresh state);
 * writes are atomic (temp + rename) so a torn write from a concurrent
 * process cannot corrupt the shared file.
 * @module @agents-web-search/pi/guard-state
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

/** Mutable browser-guard state (`disabled`/`skipClickType`/`ssrf`). */
export interface BrowserGuardState {
  disabled: boolean
  skipClickType: boolean
  ssrf: boolean
}

/** The whole `guard-state.json` map (guard name → state), `[]` on failure. */
export function readGuardFile(file: string): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, unknown>>
  } catch {
    return {}
  }
}

/** Atomic write of the whole `guard-state.json` map. */
export function writeGuardFile(file: string, all: Record<string, Record<string, unknown>>): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 2))
  renameSync(tmp, file)
}

/** The persisted browser-guard state, falling back to the config defaults
 * for keys that are absent or of the wrong shape. */
export function readBrowserGuard(file: string, cfgAllowPrivate: boolean): BrowserGuardState {
  const st = readGuardFile(file)['browser-guard'] ?? {}
  return {
    disabled: Boolean(st.disabled),
    skipClickType: Boolean(st.skipClickType),
    ssrf: typeof st.ssrf === 'boolean' ? st.ssrf : cfgAllowPrivate,
  }
}

/** True when the pi session already carries conversation history (a
 * `pi -c` / `--session` continuation). A `startup` with a non-empty session
 * history is a continuation, not a fresh session — the guard reset must not
 * fire. */
export function hasSessionHistory(ctx: ExtensionContext): boolean {
  try {
    const msgs = (ctx.sessionManager as {
      buildSessionContext?: () => { messages?: unknown[] }
    } | undefined)?.buildSessionContext?.().messages
    return Array.isArray(msgs) && msgs.length > 0
  } catch {
    return false
  }
}
