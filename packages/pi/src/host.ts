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

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CoreError, createWebStack, type HostAdapter, type ToolSpec, type WebStack } from '@agents-web-search/core'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
  ToolExecutionMode,
} from '@earendil-works/pi-coding-agent'

import { toCoreConfig, type PiConfig } from './config.ts'
import { toTypeBoxParameters } from './schema.ts'
import { truncateForPi } from './truncate.ts'

/** Tools that may run concurrently (read-only; the core single-flights search). */
const CONCURRENT_TOOLS = new Set(['web_platform_search', 'get_search_content', 'web_history', 'web_search_stats', 'web_cache_clear'])

/** Human-readable labels for `Available tools` / TUI display. */
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web search',
  web_fetch: 'Web fetch',
  web_platform_search: 'Platform search',
  web_history: 'Web history',
  web_search_stats: 'Web stats',
  web_cache_clear: 'Web cache clear',
  browser_open: 'Browser open',
  browser_navigate: 'Browser navigate',
  browser_snapshot: 'Browser snapshot',
  browser_click: 'Browser click',
  browser_type: 'Browser type',
  browser_evaluate: 'Browser evaluate',
  browser_screenshot: 'Browser screenshot',
  browser_close: 'Browser close',
}

/** One-line `Available tools` prompt snippets (pi system prompt). */
const TOOL_SNIPPETS: Record<string, string> = {
  web_search: 'Multi-engine web search (DuckDuckGo, Bing, …) with cached results',
  web_fetch: 'Fetch a web page as markdown (cached, SSRF-guarded)',
  web_platform_search: 'Platform-specific search: GitHub, Reddit, YouTube, …',
  web_history: 'Review recent web searches and fetches from the local store',
  web_search_stats: 'Show web search/page cache statistics',
  web_cache_clear: 'Clear the web search/page cache',
}

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

  // Browser approval gate toggles. Persistent: the shared
  // `<agentDir>/guard-state.json` (same file and key convention as
  // pi-extensions bash-guard/dir-guard) — survives reloads and session
  // restarts. `disabled` means the user explicitly turned confirmations OFF
  // (`/browser-guard` or `--browser-guard-off`) → approve allows immediately.
  // The fail-closed rules (no context / no dialog UI ⇒ deny) apply only when
  // the gate is enabled. Subagent processes deliberately get a fresh
  // (enabled) state — the file is NOT read there.
  const FRESH_GUARD = { disabled: false, skipClickType: false }
  const guardStateFile = join(agentDir, 'guard-state.json')
  const isSubagentProcess = Number(process.env.PI_SUBAGENT_DEPTH ?? '0') >= 1
  const browserGuard = isSubagentProcess
    ? { ...FRESH_GUARD }
    : (() => {
        try {
          const all = JSON.parse(readFileSync(guardStateFile, 'utf8')) as Record<string, Record<string, unknown>>
          const st = all['browser-guard'] ?? {}
          return { disabled: Boolean(st.disabled), skipClickType: Boolean(st.skipClickType) }
        } catch {
          return { ...FRESH_GUARD }
        }
      })()
  const saveBrowserGuard = (): void => {
    if (isSubagentProcess) return
    let all: Record<string, Record<string, unknown>> = {}
    try {
      all = JSON.parse(readFileSync(guardStateFile, 'utf8')) as Record<string, Record<string, unknown>>
    } catch {
      /* absent/corrupt ⇒ fresh */
    }
    all['browser-guard'] = { disabled: browserGuard.disabled, skipClickType: browserGuard.skipClickType }
    writeFileSync(guardStateFile, JSON.stringify(all, null, 2))
  }
  // Leading space: pi's footer sorts status entries alphabetically and
  // truncates from the right, so a leading-space key surfaces first.
  const GUARD_STATUS_KEY = ' browser-guard'

  const host: HostAdapter = {
    identity: { name: 'pi', version: '1.4.0' },
    config: coreConfig,
    paths: { stateDir, tempDir: join(stateDir, 'temp') },

    // Pi v0.1: no credentials domain — the core falls back to process.env.
    credential: async () => undefined,

    registerTools: (specs: readonly ToolSpec[]) => {
      for (const spec of specs) {
        if (!toolEnabled(spec.name, config)) continue
        pi.registerTool(toPiTool(spec, ctxSlot, lastCtx))
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
      if (browserGuard.disabled) return true
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
      if (browserGuard.skipClickType && (request.kind === 'browser_click' || request.kind === 'browser_type')) {
        return true
      }
      return ctxSlot.current.ui.confirm(
        'Web search: allow browser action?',
        `${request.kind} — ${request.description}`,
      )
    },

    // v0.1: no-op (Pi extension logging goes through the host console).
    log: () => {},

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

  // --- browser-guard: session toggle for the approval gate -----------------
  const refreshGuardStatus = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return
    if (browserGuard.disabled || browserGuard.skipClickType) {
      const { theme } = ctx.ui
      const label = browserGuard.disabled ? ' 🌐 BR OFF ' : ' 🖱 C/T OFF '
      ctx.ui.setStatus(GUARD_STATUS_KEY, theme.bg('toolErrorBg', theme.bold(theme.fg('error', label))))
    } else {
      ctx.ui.setStatus(GUARD_STATUS_KEY, undefined)
    }
  }

  pi.registerFlag('browser-guard-off', {
    description: 'Start the session with browser confirmations disabled (approval gate off for this session).',
    type: 'boolean',
    default: false,
  })

  pi.on('session_start', (event, ctx) => {
    if (event.reason === 'startup' && pi.getFlag('--browser-guard-off') === true && !browserGuard.disabled) {
      browserGuard.disabled = true
      saveBrowserGuard()
    }
    // Sync the badge on every reason (incl. "reload": the factory re-runs and
    // the state is restored from guard-state.json).
    refreshGuardStatus(ctx)
  })

  pi.registerCommand('browser-guard', {
    description: 'Toggle browser action confirmations (approval gate) for this session.',
    handler: async (_args, ctx) => {
      browserGuard.disabled = !browserGuard.disabled
      saveBrowserGuard()
      refreshGuardStatus(ctx)
      ctx.ui.notify(
        browserGuard.disabled
          ? 'browser-guard OFF for this session — browser actions run without confirmations. Run /browser-guard again to re-enable the gate.'
          : 'browser-guard back on — gated browser actions will ask for confirmation.',
        browserGuard.disabled ? 'warning' : 'info',
      )
    },
  })

  pi.registerCommand('browser-guard:click', {
    description: 'Toggle confirmations for browser_click/browser_type only (navigate/evaluate keep asking; needs the "all" approval policy).',
    handler: async (_args, ctx) => {
      browserGuard.skipClickType = !browserGuard.skipClickType
      saveBrowserGuard()
      refreshGuardStatus(ctx)
      ctx.ui.notify(
        browserGuard.skipClickType
          ? 'browser-guard: click/type confirmations OFF for this session (navigate/evaluate still ask). Run /browser-guard:click again to re-enable.'
          : 'browser-guard: click/type confirmations back on.',
        browserGuard.skipClickType ? 'warning' : 'info',
      )
    },
  })

  const stack = createWebStack(host)
  // The adapter drives tool registration (ADR-002 §2): project every core
  // tool spec to a Pi tool (the core itself never touches the host API).
  const disposeRegistered = host.registerTools(stack.tools())

  return {
    stack,
    host,
    disposeTools: disposeRegistered,
    dispose: () => void stack.dispose(),
  }
}

/**
 * Apply the `platforms.enabled` / `history.*` tool switches
 * (parity with dsh-web-automation): `false` disables the corresponding
 * tool registration (absent ⇒ enabled).
 */
function toolEnabled(name: string, config: PiConfig): boolean {
  if (name === 'web_platform_search') return config.platforms?.enabled !== false
  if (name === 'web_history') return config.history?.history !== false
  if (name === 'web_cache_clear') return config.history?.cacheClear !== false
  if (name === 'web_search_stats') return config.history?.stats !== false
  return true
}

/** Project one core `ToolSpec` to a Pi `ToolDefinition`. */
function toPiTool(
  spec: ToolSpec,
  ctxSlot: { current: ExtensionContext | undefined },
  lastCtx: { current: ExtensionContext | undefined },
) {
  return {
    name: spec.name,
    label: TOOL_LABELS[spec.name] ?? spec.name,
    description: spec.description,
    ...(TOOL_SNIPPETS[spec.name] !== undefined
      ? { promptSnippet: TOOL_SNIPPETS[spec.name] }
      : spec.name.startsWith('browser_')
        ? { promptSnippet: `Browser automation: ${spec.name.slice('browser_'.length)} (Playwright)` }
        : {}),
    parameters: toTypeBoxParameters(spec.parameters as never),
    executionMode: (CONCURRENT_TOOLS.has(spec.name) ? 'parallel' : 'sequential') as ToolExecutionMode,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<unknown> | undefined,
      ctx: ExtensionContext,
    ) {
      const previousCtx = ctxSlot.current
      ctxSlot.current = ctx
      lastCtx.current = ctx
      try {
        const controller = new AbortController()
        const onAbort = () => controller.abort()
        signal?.addEventListener('abort', onAbort, { once: true })
        try {
          const out = await spec.execute(params, {
            signal: controller.signal,
            onUpdate: (partial) =>
              onUpdate?.({ content: [{ type: 'text', text: partial.text }], details: undefined }),
          })
          if (out.isError) {
            // Pi error convention: throw — the runtime reports isError.
            throw new Error(out.text)
          }
          const result: AgentToolResult<unknown> = {
            content: [{ type: 'text', text: truncateForPi(out.text) }],
            details: out.details,
          }
          return result
        } finally {
          signal?.removeEventListener('abort', onAbort)
        }
      } finally {
        ctxSlot.current = previousCtx
      }
    },
  }
}
