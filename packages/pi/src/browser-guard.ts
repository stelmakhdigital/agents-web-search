/**
 * The browser-guard session toggle (approval gate) for the Pi adapter.
 *
 * State lives in the shared `<agentDir>/guard-state.json` (same file and key
 * convention as the pi-extensions bash-guard/dir-guard): it survives `/reload`
 * and `pi -c`; a NEW session (`pi`) resets to the config defaults. Subagent
 * processes deliberately start fresh — the file is NOT read there.
 *
 * pi 0.99.0 nuance: process startup (both `pi` and `pi -c`) emits session_start
 * with reason "startup"; a continuation is recognized by a non-empty session
 * history (`hasSessionHistory`).
 *
 * The `ssrf` toggle lives in the caller (`host.ts`) — it flips the live browser
 * session too, not just the flag.
 *
 * @module @agents-web-search/pi/browser-guard
 */

import { join } from 'node:path'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import {
  hasSessionHistory,
  readBrowserGuard,
  readGuardFile,
  writeGuardFile,
  type BrowserGuardState,
} from './guard-state.ts'

// Leading space: pi's footer sorts status entries alphabetically and truncates
// from the right, so a leading-space key surfaces first.
const GUARD_STATUS_KEY = ' browser-guard'

export interface BrowserGuard {
  /** Live state; `host.ts` (approve gate, ssrf toggle) reads it directly. */
  readonly state: BrowserGuardState
  /** Persist the current state under the `browser-guard` key. */
  save(): void
  /** Sync the footer badge with the current state. */
  refresh(ctx: ExtensionContext): void
  /** Reset rules + `--browser-guard-off` + badge; call from session_start. */
  onSessionStart(event: { reason?: string }, ctx: ExtensionContext): void
}

/**
 * Restore the guard state and register the `--browser-guard-off` flag and the
 * two confirmation toggles. The session_start wiring stays with the caller
 * (`host.ts`) so the extension keeps ONE session_start handler.
 */
export function registerBrowserGuard(
  pi: ExtensionAPI,
  opts: { agentDir: string; cfgAllowPrivate: boolean; isSubagent: boolean },
): BrowserGuard {
  const { agentDir, cfgAllowPrivate, isSubagent } = opts
  const stateFile = join(agentDir, 'guard-state.json')
  const fresh = (): BrowserGuardState => ({ disabled: false, skipClickType: false, ssrf: cfgAllowPrivate })
  const state: BrowserGuardState = isSubagent ? fresh() : readBrowserGuard(stateFile, cfgAllowPrivate)

  const save = (): void => {
    if (isSubagent) return
    // Read-modify-write: the file is shared with the pi-extensions guards
    // (bash-guard, dir-guard); the fresh read keeps their entries intact.
    const all = readGuardFile(stateFile)
    all['browser-guard'] = {
      disabled: state.disabled,
      skipClickType: state.skipClickType,
      ssrf: state.ssrf,
    }
    writeGuardFile(stateFile, all)
  }

  const refresh = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return
    const parts: string[] = []
    if (state.disabled) parts.push(' 🌐 BR OFF ')
    else if (state.skipClickType) parts.push(' 🖱 C/T OFF ')
    if (state.ssrf) parts.push(' 🔓 SSRF OFF ')
    if (parts.length === 0) {
      ctx.ui.setStatus(GUARD_STATUS_KEY, undefined)
      return
    }
    const { theme } = ctx.ui
    ctx.ui.setStatus(GUARD_STATUS_KEY, theme.bg('toolErrorBg', theme.bold(theme.fg('error', parts.join('')))))
  }

  pi.registerFlag('browser-guard-off', {
    description: 'Start the session with browser confirmations disabled (approval gate off for this session).',
    type: 'boolean',
    default: false,
  })

  function onSessionStart(event: { reason?: string }, ctx: ExtensionContext): void {
    // A new session (startup with an empty history, "new") → defaults (gates
    // ON) + persist; a continuation (pi -c / --session / resume / reload /
    // fork) → the saved state (the factory already re-read guard-state.json).
    // Subagents never reset. (parity with bash-guard/dir-guard)
    const shouldReset =
      !isSubagent &&
      event.reason !== 'resume' &&
      event.reason !== 'reload' &&
      event.reason !== 'fork' &&
      !((event.reason === 'startup' || event.reason === undefined) && hasSessionHistory(ctx))
    if (shouldReset) {
      Object.assign(state, fresh())
      save()
    }
    if (event.reason === 'startup' && pi.getFlag('browser-guard-off') === true && !state.disabled) {
      state.disabled = true
      save()
    }
    // Sync the badge on every reason (incl. "reload": the factory re-runs and
    // the state is restored from guard-state.json).
    refresh(ctx)
  }

  pi.registerCommand('browser-guard', {
    description: 'Toggle browser action confirmations (approval gate) for this session.',
    handler: async (_args, ctx) => {
      state.disabled = !state.disabled
      save()
      refresh(ctx)
      ctx.ui.notify(
        state.disabled
          ? 'browser-guard OFF — browser actions run without confirmations. Remembered: survives /reload and pi -c; a new session starts with the gate on. Run /browser-guard again to re-enable.'
          : 'browser-guard back on — gated browser actions will ask for confirmation.',
        state.disabled ? 'warning' : 'info',
      )
    },
  })

  pi.registerCommand('browser-guard:click', {
    description: 'Toggle confirmations for browser_click/browser_type only (navigate/evaluate keep asking; needs the "all" approval policy).',
    handler: async (_args, ctx) => {
      state.skipClickType = !state.skipClickType
      save()
      refresh(ctx)
      ctx.ui.notify(
        state.skipClickType
          ? 'browser-guard: click/type confirmations OFF (navigate/evaluate still ask). Remembered: survives /reload and pi -c; a new session starts with confirmations on. Run /browser-guard:click again to re-enable.'
          : 'browser-guard: click/type confirmations back on.',
        state.skipClickType ? 'warning' : 'info',
      )
    },
  })

  return { state, save, refresh, onSessionStart }
}
