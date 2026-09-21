/**
 * The DSH implementation of the core's `HostAdapter` contract (ADR-002).
 *
 * Bridges the cordis host to the agent-agnostic core:
 * - identity/config/paths: cordis config → `CoreConfig` (config.ts), `$DSH_HOME`
 *   state dir;
 * - credential: DSH credentials domain → launch environment (per-search
 *   resolution, a key written to the credentials domain takes effect without a
 *   restart; the process-env layer stays in the core);
 * - registerTools: core `ToolSpec` → `defineTool` (JSON Schema → property-map
 *   projection, schema.ts); `web_search`/`web_fetch` are NOT registered — the
 *   host's `tool-web` owns those tools (ADR-002 §2);
 * - approve: delegates to the host approval service (`ctx.get('approval')`),
 *   fail-closed (no service / no agent ⇒ `BROWSER_APPROVAL_UNAVAILABLE`);
 * - toHostError: `CoreError` → `WebError` (codes are parity by name, ADR-002 §3).
 * @module @agents-web-search/dsh/host
 */

import {
  CoreError,
  createWebStack,
  type ApprovalRequest,
  type HostAdapter,
  type ToolSpec,
  type WebStack,
} from '@agents-web-search/core'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Structural mirror of dsh-tools' `JsonValue` (the tool output schema is JSON). */
type JsonValueLike = null | boolean | number | string | JsonValueLike[] | { [key: string]: JsonValueLike }
import { WebError } from '@deepseek-ai/dsh-web'
import { dirname } from 'node:path'

import type { Config } from './config.ts'
import { toCoreConfig } from './config.ts'
import { createDshLlmClient } from './llm.ts'
import { toDshParameterSchema } from './schema.ts'

/** The plugin name (cordis companion identity). */
export const PLUGIN_NAME = 'agents-web-search'

/** The seam provider ids (parity with the built-in web packages; the overlay pins them). */
export const SEARCH_PROVIDER_ID = 'multi'
export const FETCH_PROVIDER_ID = 'cached-http'

/**
 * Host tools the adapter must NOT register: the host's `tool-web` plugin owns
 * `web_search`/`web_fetch` (ADR-002 §2). The adapter registers the core's
 * platform/history/browser tools instead.
 */
const HOST_OWNED_TOOLS = new Set(['web_search', 'web_fetch'])

/** Tools that are safe to run in parallel sibling groups (no shared mutable state). */
const CONCURRENT_TOOLS = new Set(['web_platform_search', 'get_search_content', 'web_history', 'web_search_stats', 'web_cache_clear'])

/** Settings namespace for the plugin's config section. */
export const SETTINGS_NAMESPACE = 'agents-web-search'

/** Map a core credential name (`websearch:<engine>`) to its default env name. */
const CREDENTIAL_ENV_DEFAULTS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  exa: 'EXA_API_KEY',
  tavily: 'TAVILY_API_KEY',
  brave: 'BRAVE_API_KEY',
  jina: 'JINA_API_KEY',
}

/** The built stack plus the registration disposer (closed by the fiber effect). */
export interface DshWebStack {
  readonly stack: WebStack
  /** The host adapter (exposed for tests; production code uses only `stack`). */
  readonly host: HostAdapter
  /**
   * Run `fn` with the current tool-exec context set (the approval bridge).
   * Test seam: `host.approve` needs the active exec (agent/callId) that the
   * tool wrapper sets during `spec.execute`; tests invoke it directly.
   */
  withExec(exec: ToolRunContext | undefined, fn: () => unknown): unknown
  /** Unregisters the adapter's tools. */
  disposeTools(): void
}

/**
 * Map a core error to a host `WebError`. Codes are parity by name
 * (WEB_* and BROWSER_* already match the DSH vocabulary, ADR-002 §3).
 * @param err - the error to map.
 * @returns a `WebError` carrying the same message and a routable code.
 */
export function toHostError(err: unknown): WebError {
  if (err instanceof CoreError) {
    return new WebError(err.message, err.code, { cause: err.cause })
  }
  const message = err instanceof Error ? err.message : String(err)
  return new WebError(message, 'WEB_INTERNAL', { cause: err })
}

/** Parse a core isError output (`Error (CODE): message`) back into a WebError. */
function outputError(text: string): WebError {
  const match = /^Error \(([A-Z0-9_]+)\): ([\s\S]*)$/.exec(text)
  if (match !== null && match[1] !== undefined && match[2] !== undefined) {
    return new WebError(match[2], match[1])
  }
  return new WebError(text, 'WEB_INTERNAL')
}

/**
 * Build the HostAdapter for the DSH host, create the core stack, and register
 * the adapter's tools (everything except the host-owned web_search/web_fetch).
 * The caller owns the stack's lifecycle (close it via a `ctx.effect`).
 * @param ctx - the cordis plugin context.
 * @param config - the resolved plugin config (schemastery defaults applied).
 * @returns the stack and the tool-registration disposer.
 */
export function buildDshWebStack(ctx: Context, config: Config): DshWebStack {
  const coreConfig = toCoreConfig(config)
  const stateDir = dirname(dshHomePath('web.db'))
  let currentExec: ToolRunContext | undefined
  let stackRef: WebStack

  const host: HostAdapter = {
    identity: { name: 'dsh', version: '1.0.1' }, // keep in sync with package.json (UA/logs/stats)
    config: coreConfig,
    paths: {
      stateDir,
      tempDir: `${stateDir}/web-search-temp`,
    },

    // ADR-002 §6: explicit config literal (core layer) → credentials domain →
    // launch environment (both resolved here, per search) → process env (core).
    credential: async (name: string) => {
      const engine = name.replace(/^websearch:/, '')
      const configured = (config.providers?.[engine as keyof Config['providers']] as { apiKeyEnv?: string } | undefined)?.apiKeyEnv
      const ref = configured ?? CREDENTIAL_ENV_DEFAULTS[engine]
      if (ref === undefined) return undefined
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(credentialRef(ref))
        if (resolved !== undefined && resolved.value.length > 0) return resolved.value
      }
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) return ambient.value
      return undefined
    },

    registerTools: (specs: readonly ToolSpec[]) => {
      const unregisters: Array<() => void> = []
      for (const spec of specs) {
        if (HOST_OWNED_TOOLS.has(spec.name)) continue
        const unregister = ctx.tools.register(defineTool({
          name: spec.name,
          description: spec.description,
          parameters: toDshParameterSchema(spec.parameters as never),
          output: {
            schema: { type: 'json' },
            render: (_args: unknown, value: { text: string }) => [{ type: 'text', text: value.text }],
          },
          isConcurrencySafe: () => CONCURRENT_TOOLS.has(spec.name),
          async execute(args: unknown, exec: ToolRunContext) {
            currentExec = exec
            try {
              const out = await spec.execute(args, { signal: exec.signal })
              if (out.isError) throw outputError(out.text)
              return { text: out.text, ...(out.details !== undefined ? { details: out.details as JsonValueLike } : {}) }
            } finally {
              currentExec = undefined
            }
          },
        }))
        unregisters.push(unregister)
      }
      return () => {
        for (const unregister of unregisters) unregister()
      }
    },

    toHostError: (err: CoreError): unknown => toHostError(err),

    // ADR-005 §3: delegate to the host approval service; fail closed when the
    // service or the routing agent is unavailable (denied, not allowed).
    approve: async (request: ApprovalRequest) => {
      const exec = currentExec
      if (exec === undefined || exec.agent === undefined) {
        throw new CoreError(
          'approval is required, but the call has no agent to route it through',
          'BROWSER_APPROVAL_UNAVAILABLE',
        )
      }
      const approver = ctx.get('approval')
      if (approver === undefined) {
        throw new CoreError(
          'the DSH approval service is unavailable; set browser.approval to "never" to disable gating',
          'BROWSER_APPROVAL_UNAVAILABLE',
        )
      }
      const outcome = await approver.request({
        agent: exec.agent,
        toolName: request.kind,
        callId: exec.callId,
        reason: request.description,
        signal: exec.signal,
      })
      return outcome === 'allowed-once'
    },

    log: (level, message, meta) => {
      const logger = ctx.logger
      if (logger === undefined) return
      const args: unknown[] = meta !== undefined ? [meta] : []
      switch (level) {
        case 'debug': logger.debug(message, ...args); break
        case 'info': logger.info(message, ...args); break
        case 'warn': logger.warn(message, ...args); break
        case 'error': logger.error(message, ...args); break
      }
    },

    // Roadmap 5.4: auxiliary LLM (curator summaries, web_fetch question mode).
    // DEEPSEEK_API_KEY (env) → DeepSeek chat-completions; undefined (fail-closed)
    // when the key is absent.
    llm: createDshLlmClient(),

    dispose: async () => {
      void stackRef.dispose()
    },
  }

  const stack = createWebStack(host)
  stackRef = stack
  const disposeTools = host.registerTools(stack.tools())
  const withExec = (exec: ToolRunContext | undefined, fn: () => unknown): unknown => {
    const previous = currentExec
    currentExec = exec
    try {
      return fn()
    } finally {
      currentExec = previous
    }
  }
  return { stack, host, withExec, disposeTools }
}

/**
 * Wrap a core tool output in a host tool result: core outputs are never thrown
 * (isError + `Error (CODE): message`), DSH tool semantics prefer throwing a
 * `WebError` with a routable code — re-throw mapped errors, pass text through.
 * (Kept exported for tests.)
 * @returns the mapped host error for an isError output.
 */
export function hostErrorOfOutput(text: string): WebError {
  return outputError(text)
}
