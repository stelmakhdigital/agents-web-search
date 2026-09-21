import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

import { CoreError, errorCodeOf } from '@agents-web-search/core'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { buildPiWebStack, type PiWebStackResult } from '../src/host.ts'
import { CONFIG_FILE_NAME, type PiConfig } from '../src/config.ts'

interface RegisteredTool {
  name: string
  label: string
  description: string
  promptSnippet?: string
  parameters: unknown
  executionMode: 'sequential' | 'parallel'
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>
}

function makeMockPi() {
  const tools: RegisteredTool[] = []
  const handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {}
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      tools.push(tool)
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers[event] ??= []
      handlers[event].push(handler)
      return () => {}
    }),
  }
  return { pi: pi as unknown as ExtensionAPI, tools, handlers }
}

function makeCtx(overrides: { hasUI?: boolean; confirm?: () => Promise<boolean> } = {}): ExtensionContext {
  return {
    hasUI: overrides.hasUI ?? true,
    ui: {
      confirm: overrides.confirm ?? (async () => true),
      select: async () => undefined,
      input: async () => undefined,
      notify: () => {},
    },
    mode: 'tui',
    cwd: process.cwd(),
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => '',
    sessionManager: {},
    modelRegistry: {},
    model: undefined,
    scopedModels: [],
  } as unknown as ExtensionContext
}

describe('buildPiWebStack (real core + mocked Pi API)', () => {
  let agentDir: string
  const savedEnv = process.env.PI_CODING_AGENT_DIR

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'aws-pi-host-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
  })
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    await rm(agentDir, { recursive: true, force: true })
  })

  function build(config: PiConfig = {}): { result: PiWebStackResult; tools: RegisteredTool[] } {
    const mock = makeMockPi()
    const result = buildPiWebStack(mock.pi, config)
    return { result, tools: mock.tools }
  }

  it('registers the six core tools (browser off by default)', () => {
    const { result, tools } = build()
    const names = tools.map(t => t.name)
    expect(names).toEqual([
      'web_search',
      'web_fetch',
      'web_platform_search',
      'web_history',
      'web_search_stats',
      'web_cache_clear',
    ])
    expect(result.stack.config.search.mode).toBe('fallback')
    // host identity + state dir under the agent dir
    expect(result.host.identity).toEqual({ name: 'pi', version: '0.1.0' })
    expect(result.host.paths.stateDir).toBe(join(agentDir, 'web-search'))
  })

  it('assigns labels, snippets and concurrency modes', () => {
    const { tools } = build()
    const byName = Object.fromEntries(tools.map(t => [t.name, t]))
    expect(byName.web_search?.label).toBe('Web search')
    expect(byName.web_search?.promptSnippet).toContain('web search')
    expect(byName.web_history?.executionMode).toBe('parallel')
    expect(byName.web_search?.executionMode).toBe('sequential')
    // typebox object schemas (all-optional params → empty/absent `required`)
    const historySchema = byName.web_history?.parameters as {
      required?: string[]
      properties?: Record<string, unknown>
    }
    expect(historySchema?.required ?? []).toEqual([])
    expect(historySchema?.properties?.kind).toBeDefined()
  })

  it('respects history/platforms tool switches', () => {
    const { tools } = build({ history: { history: false, stats: false }, platforms: { enabled: false } })
    const names = tools.map(t => t.name)
    expect(names).toEqual(['web_search', 'web_fetch', 'web_cache_clear'])
  })

  it('exposes host.llm via the Pi model registry (roadmap 5.4)', async () => {
    // Fail-closed before any tool execution has captured a context.
    const { result: pristine } = build()
    await expect(pristine.host.llm!.complete({ prompt: 'x' })).rejects.toThrow(/no Pi execution context or model/)

    const { result, tools } = build()
    const webHistory = tools.find(t => t.name === 'web_history')!
    const complete = vi.fn(async () => ({
      role: 'assistant',
      content: [{ type: 'text', text: 'pi summary' }],
      model: 'test-model',
      usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0, output: 0, total: 0 } },
      stopReason: 'stop',
    }))
    const ctxWithModel = {
      ...makeCtx(),
      model: { id: 'test-model' },
      modelRegistry: { complete },
    } as unknown as ExtensionContext
    await webHistory.execute('t1', { kind: 'all', limit: 3 }, new AbortController().signal, undefined, ctxWithModel)
    expect(complete).toHaveBeenCalledTimes(0) // the tool itself does not call the LLM
    const out = await result.host.llm!.complete({ prompt: 'summarize' })
    expect(out.text).toBe('pi summary')
    expect(out.model).toBe('test-model')
    expect(out.usage).toEqual({ in: 3, out: 4 })
    expect(complete).toHaveBeenCalledTimes(1)
    await result.dispose()
  })

  it('registers the eight browser_* tools when browser.enabled', () => {
    const { result, tools } = build({ browser: { enabled: true } })
    const names = tools.map(t => t.name)
    expect(names).toHaveLength(14)
    expect(names).toContain('browser_navigate')
    const nav = tools.find(t => t.name === 'browser_navigate')
    expect(nav?.executionMode).toBe('sequential')
    expect(nav?.promptSnippet).toContain('Playwright')
    expect(result.stack.config.browser?.enabled).toBe(true)
  })

  it('runs a core tool end-to-end (web_history)', async () => {
    const { result, tools } = build()
    const history = tools.find(t => t.name === 'web_history')
    const out = await history?.execute('call-1', { kind: 'search' }, new AbortController().signal, undefined, makeCtx())
    expect(out?.content).toEqual([{ type: 'text', text: 'No matching history entries.' }])
    expect(out?.details).toBeUndefined()
    await result.dispose()
  })

  it('maps core errors to thrown Errors with the core text convention', async () => {
    const { result, tools } = build()
    const fetch = tools.find(t => t.name === 'web_fetch')
    await expect(
      fetch?.execute(
        'call-2',
        { url: 'http://127.0.0.1:9999/private' },
        new AbortController().signal,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow('Error (WEB_SSRF_BLOCKED)')
    await result.dispose()
  })

  it('toHostError wraps CoreError into the core text convention', () => {
    const { result } = build()
    const wrapped = result.host.toHostError(new CoreError('boom', 'WEB_SEARCH_TIMEOUT'))
    expect(wrapped).toBeInstanceOf(Error)
    expect((wrapped as Error).message).toBe('Error (WEB_SEARCH_TIMEOUT): boom')
    expect(errorCodeOf(wrapped)).toBe('WEB_INTERNAL') // plain Error: no machine code (Pi shows the text)
  })

  it('approve: fail-closed without an execution context', async () => {
    const { result } = build({ browser: { enabled: true } })
    await expect(result.host.approve?.({ kind: 'browser_navigate', description: 'x' })).rejects.toMatchObject({
      code: 'BROWSER_APPROVAL_UNAVAILABLE',
    })
  })

  it('approve: denies when the UI is not dialog-capable (json/print mode)', async () => {
    const { result, tools } = build({ browser: { enabled: true } })
    const nav = tools.find(t => t.name === 'browser_navigate')
    await expect(
      nav?.execute(
        'call-3',
        { url: 'https://example.com/' },
        new AbortController().signal,
        undefined,
        makeCtx({ hasUI: false }),
      ),
    ).rejects.toThrow('Error (BROWSER_APPROVAL_DENIED)')
    await result.dispose()
  })

  it('approve: denies when the user confirms NO', async () => {
    const { result, tools } = build({ browser: { enabled: true } })
    const nav = tools.find(t => t.name === 'browser_navigate')
    await expect(
      nav?.execute(
        'call-4',
        { url: 'https://example.com/' },
        new AbortController().signal,
        undefined,
        makeCtx({ confirm: async () => false }),
      ),
    ).rejects.toThrow('Error (BROWSER_APPROVAL_DENIED)')
    await result.dispose()
  })

  it('applies the configured store path', () => {
    const custom = join(agentDir, 'custom.db')
    const { result } = build({ search: { storePath: custom } })
    expect(result.stack.config.store?.path).toBe(custom)
  })

  it('dispose closes the stack cleanly and is idempotent', async () => {
    const { result } = build()
    await result.dispose()
    await result.dispose()
    expect(result.host.dispose).toBeTypeOf('function')
  })

  it('reads the agent dir from the environment (PI_CODING_AGENT_DIR)', async () => {
    const { result } = build()
    // a config file written next to the store dir must be picked up by the extension entry
    const file = join(agentDir, CONFIG_FILE_NAME)
    await writeFile(file, JSON.stringify({ platforms: { enabled: false } }))
    const { loadPiConfig } = await import('../src/config.ts')
    expect(loadPiConfig(agentDir).platforms?.enabled).toBe(false)
    await result.dispose()
  })
})
