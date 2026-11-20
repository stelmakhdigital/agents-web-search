/**
 * The Pi `HostAdapter` implementation (ADR-002): maps the Pi extension
 * runtime onto the core's host contract.
 *
 * - `paths`: `<agentDir>/web-search` state (store, temp) — the agent dir
 *   comes from the host (`getAgentDir()`, honors `$PI_CODING_AGENT_DIR`);
 * - `credential`: the process environment (the core's env fallback layer);
 *   Pi has no credentials domain in v0.1, and explicit keys come from the
 *   config file (`providers.*.apiKey`);
 * - `registerTools`: `pi.registerTool` with typebox schemas (host-level
 *   50KB/2000-line truncate applied to every result, ADR-002 §2);
 * - `toHostError`: a thrown `Error` whose message keeps the machine-routable
 *   core code (`Error (CODE): message` — the core's own text convention);
 * - `approve`: `ctx.ui.confirm` (permission gate, 4.5) — fail-closed: no
 *   active tool context or no dialog-capable UI ⇒ the action is DENIED
 *   (ADR-005 §3); session-level opt-out via `/browser-guard` or
 *   `--browser-guard-off` (footer badge `🌐 BR OFF`);
 * - `llm`: not implemented in v0.1 (curator — phase 5).
 *
 * @module @agents-web-search/pi/host
 */

import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { CoreError, createWebStack, type HostAdapter, type ToolSpec, type WebStack } from '@agents-web-search/core'
import { registerBrowserGuard } from './browser-guard.ts'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { toCoreConfig, type PiConfig } from './config.ts'
import { toPiTool, toolEnabled } from './pi-tool.ts'
import { runStartupProbes } from './startup-probes.ts'
import { runWebSearchSetup, scriptPath } from './setup-command.ts'

/** The built stack plus its host adapter and lifecycle handle. */
export interface PiWebStackResult {
  /** The core stack (search/fetch/store/browser/tools). */
  stack: WebStack
  /** The host adapter (tests, diagnostics). */
  host: HostAdapter
  /** Unregister the adapter's tools (no-op in Pi v0.1 — see module docs). */
  disposeTools(): void
  /** Close the stack (store, browser sessions). Idempotent. */
  dispose(): void
}

/**
 * Build the core web stack for the Pi host and register its tools.
 * @param pi - the Pi extension API.
 * @param config - the parsed Pi adapter config.
 * @returns the stack, the host adapter, and the lifecycle handles.
 */
export function buildPiWebStack(pi: ExtensionAPI, config: PiConfig): PiWebStackResult {
  const coreConfig = toCoreConfig(config)
  const agentDir = getAgentDir()
  const stateDir = join(agentDir, 'web-search')

  // The current tool-execution context (captured by the execute wrappers;
  // used by `approve`). v0.1 limitation: a single shared slot — browser
  // tools execute sequentially, read-only tools are harmless sharers.
  // The active tool-execution context (restored after each tool — approval
  // only routes through the running agent) and the LAST observed context
  // (never reset — the LLM client works outside tool execution too).
  const ctxSlot: { current: ExtensionContext | undefined } = { current: undefined }
  const lastCtx: { current: ExtensionContext | undefined } = { current: undefined }

  // Set when the startup SearXNG health-check finds the local instance dead;
  // the first `web_search` of the session then carries an explanatory note
  // (the model otherwise has no way to know results came from the fallback).
  const searxngDown: { value?: string } = { value: undefined }

  // Host-side debug log: WEB_SEARCH_DEBUG=1 (or `debug.log`-style env) routes
  // the core's structured log lines into `<stateDir>/log.txt`.
  const debugLog = process.env['WEB_SEARCH_DEBUG'] === '1'
  const logFile = join(stateDir, 'log.txt')
  const appendLog = (level: string, message: string, meta?: Record<string, unknown>): void => {
    try {
      const line = `[${new Date().toISOString()}] ${level} ${message}${
        meta !== undefined && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
      }\n`
      appendFileSync(logFile, line)
    } catch {
      /* logging must never break the tool */
    }
  }

  // Browser approval gate: state, footer badge, session reset and the two
  // confirmation toggles live in browser-guard.ts (persisted in the shared
  // guard-state.json, parity with pi-extensions bash-guard/dir-guard).
  // `ssrf` is the runtime override of the browser SSRF guard; the config value
  // (`browser.allowPrivateNetworks`) is its default — the toggle logic needs
  // the live browser session and therefore stays here.
  const isSubagentProcess = Number(process.env.PI_SUBAGENT_DEPTH ?? '0') >= 1
  const guard = registerBrowserGuard(pi, {
    agentDir,
    cfgAllowPrivate: config.browser?.allowPrivateNetworks ?? false,
    isSubagent: isSubagentProcess,
  })

  // Версия идентичности — из package.json рядом (один источник правды;
  // хардкод расходится при релизах, а UA `pi/<version>` — антибот-сигнал ядра).
  const pkgVersion = (createRequire(import.meta.url)('../package.json') as { version: string }).version
  const host: HostAdapter = {
    identity: { name: 'pi', version: pkgVersion },
    config: coreConfig,
    paths: { stateDir, tempDir: join(stateDir, 'temp') },

    // Pi v0.1: no credentials domain — the core falls back to process.env.
    credential: async () => undefined,

    registerTools: (specs: readonly ToolSpec[]) => {
      for (const spec of specs) {
        if (!toolEnabled(spec.name, config)) continue
        pi.registerTool(toPiTool(spec, { config, ctxSlot, lastCtx, searxngDown }))
      }
      // Pi has no tool-unregistration API in v0.1: the disposer is a no-op;
      // session_shutdown closes the stack (store/browser) instead.
      return () => {}
    },

    toHostError: (error: unknown) => {
      if (error instanceof CoreError) {
        return new Error(`Error (${error.code}): ${error.message}`)
      }
      return error instanceof Error ? error : new Error(String(error))
    },

    // Permission gate (4.5): confirm through the Pi UI, fail-closed.
    approve: async (request: { kind: string; description: string }) => {
      // Explicit session-level opt-out (`/browser-guard` / `--browser-guard-off`):
      // the user has already decided — no dialog, including without a UI.
      if (guard.state.disabled) return true
      if (ctxSlot.current === undefined) {
        throw new CoreError(
          `browser ${request.kind.slice('browser_'.length)} requires approval, but no tool execution context is available — the action is denied (fail-closed)`,
          'BROWSER_APPROVAL_UNAVAILABLE',
        )
      }
      if (!ctxSlot.current.hasUI) {
        // No dialog-capable UI (json/print mode): deny, never auto-allow
        // (the click/type relaxation below applies only to dialog sessions).
        return false
      }
      if (guard.state.skipClickType && (request.kind === 'browser_click' || request.kind === 'browser_type')) {
        return true
      }
      return ctxSlot.current.ui.confirm(
        'Web search: allow browser action?',
        `${request.kind} — ${request.description}`,
      )
    },

    // Debug log: off by default (WEB_SEARCH_DEBUG=1 appends to <stateDir>/log.txt).
    log: (level, message, meta) => {
      if (debugLog) appendLog(level, message, meta)
    },

    // Roadmap 5.4: auxiliary LLM via the Pi model registry (curator
    // summaries, web_fetch question mode). Uses the latest tool-execution
    // context (lastCtx — the newest tool-execution context, kept after the
    // tool returns) — fail-closed before any tool has run or when the session
    // has no model.
    llm: {
      async complete({ prompt, maxTokens, signal }) {
        const ctx = lastCtx.current
        if (ctx === undefined || ctx.model === undefined || ctx.modelRegistry === undefined) {
          throw new CoreError(
            'the LLM is unavailable: no Pi execution context or model has been observed yet',
            'WEB_NOT_AVAILABLE',
          )
        }
        const message = await ctx.modelRegistry.complete(
          ctx.model,
          {
            messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }],
            ...(maxTokens !== undefined ? { maxTokens } : {}),
            ...(signal !== undefined ? { signal } : {}),
          },
        )
        const text = message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n')
          .trim()
        if (text.length === 0) {
          throw new CoreError('the Pi model returned an empty completion', 'WEB_NOT_AVAILABLE')
        }
        return {
          text,
          model: message.responseModel ?? message.model,
          usage: { in: message.usage.input, out: message.usage.output },
        }
      },
    },

    dispose: () => stack.dispose(),
  }

  // ОДИН session_start-хендлер на расширение: сначала правила сброса и бейдж
  // browser-guard, затем проверки окружения (SearXNG, браузер).
  pi.on('session_start', (event, ctx) => {
    guard.onSessionStart(event, ctx)
    if (event.reason === 'startup') {
      runStartupProbes(pi, config, ctx, { isSubagent: isSubagentProcess, searxngDown })
    }
  })

  const stack = createWebStack(host)
  // The adapter drives tool registration (ADR-002 §2): project every core
  // tool spec to a Pi tool (the core itself never touches the host API).
  const disposeRegistered = host.registerTools(stack.tools())

  // --- browser-guard:ssrf — runtime override of the SSRF flag --------------
  // The core bakes `browser.allowPrivateNetworks` into the provider at stack
  // construction; the provider and every session keep it in a public mutable
  // field, so the override (1) stamps future sessions through a one-time
  // open() wrap and (2) flips the live session's field in place.
  const manager = stack.browser
  if (manager !== undefined && typeof manager.open === 'function') {
    const origOpen = manager.open.bind(manager)
    manager.open = (async (agent?: unknown, options?: Parameters<typeof origOpen>[1], signal?: AbortSignal) => {
      const session = await origOpen(agent, options, signal)
      ;(session as unknown as { allowPrivateNetworks: boolean }).allowPrivateNetworks = guard.state.ssrf
      return session
    }) as typeof manager.open
  }
  const setSsrf = (allow: boolean): void => {
    guard.state.ssrf = allow
    const live = stack.browser?.session?.()
    if (live !== undefined) (live as unknown as { allowPrivateNetworks: boolean }).allowPrivateNetworks = allow
  }

  pi.registerCommand('browser-guard:ssrf', {
    description:
      'Toggle the browser SSRF guard: allow/block private & reserved addresses (LAN, 127.0.0.1). A network boundary — independent of the confirmation gate.',
    handler: async (_args, ctx) => {
      if (manager === undefined) {
        ctx.ui.notify(
          'browser-guard:ssrf: the browser module is off (browser.enabled in web-search.json) — nothing to toggle.',
          'warning',
        )
        return
      }
      setSsrf(!guard.state.ssrf)
      guard.save()
      guard.refresh(ctx)
      ctx.ui.notify(
        guard.state.ssrf
          ? 'browser-guard:ssrf — SSRF guard OFF: private/reserved addresses (LAN, 127.0.0.1) are allowed. Remembered: survives /reload and pi -c; a new session falls back to the config value (browser.allowPrivateNetworks). Run /browser-guard:ssrf again to re-enable the guard.'
          : 'browser-guard:ssrf — SSRF guard back on: private/reserved addresses are blocked (BROWSER_SSRF_BLOCKED).',
        guard.state.ssrf ? 'warning' : 'info',
      )
    },
  })

  pi.registerCommand('web-search-setup', {
    description:
      'Install everything the web-search plugin can install without root (Chromium binary, local SearXNG); print the exact command for the root-only parts (system libraries).',
    handler: async (_args, ctx) => {
      ctx.ui.notify('web-search-setup: проверяю и дозаполняю компоненты (может занять минуты)…', 'info')
      try {
        const lines = await runWebSearchSetup({ config })
        for (const line of lines) {
          ctx.ui.notify(`web-search-setup: ${line.text}`, line.level)
          try { pi.appendEntry('web-search-setup', { text: line.text, level: line.level }) } catch { /* best-effort */ }
        }
      } catch (error) {
        ctx.ui.notify(
          `web-search-setup: сорвалось — ${error instanceof Error ? error.message : String(error)}. Отдельно: bash ${scriptPath('browser/install.sh')} и bash ${scriptPath('searxng/install.sh')}`,
          'warning',
        )
      }
    },
  })

  return {
    stack,
    host,
    disposeTools: disposeRegistered,
    dispose: () => void stack.dispose(),
  }
}
