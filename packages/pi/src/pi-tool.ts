/**
 * Projection of core `ToolSpec`s onto Pi tools (ADR-002 §2): labels, prompt
 * snippets, the `platforms.enabled` / `history.*` switches, and the execute
 * wrapper (context capture, abort bridging, error-by-throw, SearXNG fallback
 * note, host truncation).
 *
 * Split out of `host.ts`; the host adapter owns registration.
 *
 * @module @agents-web-search/pi/pi-tool
 */

import { CONCURRENT_TOOLS, type ToolSpec } from '@agents-web-search/core'
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolExecutionMode,
} from '@earendil-works/pi-coding-agent'

import type { PiConfig } from './config.ts'
import { toTypeBoxParameters } from './schema.ts'
import { truncateForPi } from './truncate.ts'

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

/**
 * Apply the `platforms.enabled` / `history.*` tool switches
 * (parity with dsh-web-automation): `false` disables the corresponding
 * tool registration (absent ⇒ enabled).
 */
export function toolEnabled(name: string, config: PiConfig): boolean {
  if (name === 'web_platform_search') return config.platforms?.enabled !== false
  if (name === 'web_history') return config.history?.history !== false
  if (name === 'web_cache_clear') return config.history?.cacheClear !== false
  if (name === 'web_search_stats') return config.history?.stats !== false
  return true
}

/** Shared per-session slots the execute wrapper reads and writes. */
export interface PiToolDeps {
  config: PiConfig
  /** The tool-execution context of the currently running tool (approval gate). */
  ctxSlot: { current: ExtensionContext | undefined }
  /** The LAST observed context (never reset — the LLM client works outside tool execution). */
  lastCtx: { current: ExtensionContext | undefined }
  /** Set by the startup health-check when the local SearXNG is dead; the first
   * `web_search` of the session then explains the fallback to the model. */
  searxngDown: { value?: string }
}

/** Project one core `ToolSpec` to a Pi `ToolDefinition`. */
export function toPiTool(spec: ToolSpec, deps: PiToolDeps) {
  const { config, ctxSlot, lastCtx, searxngDown } = deps
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
          let text = out.text
          // The startup health-check found the local SearXNG dead: explain
          // the fallback to the model once, on the first web_search result.
          if (spec.name === 'web_search' && searxngDown.value !== undefined) {
            text += `\n\nNote: the local SearXNG instance at ${searxngDown.value} is unreachable — `
              + 'results came from the ddg/bing fallback. Install or repair the instance with '
              + 'agents-web-search scripts/searxng/install.sh, or remove searxng from search.engines.'
            searxngDown.value = undefined
          }
          const result: AgentToolResult<unknown> = {
            content: [{ type: 'text', text: truncateForPi(text) }],
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
