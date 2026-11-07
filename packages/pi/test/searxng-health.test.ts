import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { buildPiWebStack } from '../src/host.ts'
import { SEARXNG_HEALTH_TIMEOUT_MS, searxngAlive, searxngEndpoint, searxngInEngines } from '../src/searxng-health.ts'
import type { PiConfig } from '../src/config.ts'

describe('searxng-health (config helpers)', () => {
  it('searxngInEngines: unset engines inherit the core default chain (searxng present)', () => {
    expect(searxngInEngines({})).toBe(true)
    expect(searxngInEngines({ search: {} })).toBe(true)
  })

  it('searxngInEngines: explicit list decides', () => {
    expect(searxngInEngines({ search: { engines: ['searxng', 'ddg'] } })).toBe(true)
    expect(searxngInEngines({ search: { engines: ['ddg', 'bing'] } })).toBe(false)
    expect(searxngInEngines({ search: { engines: ['SEARXNG'] } })).toBe(true) // case-insensitive
  })

  it('searxngEndpoint: core default, config override, trailing-slash trim', () => {
    expect(searxngEndpoint({})).toBe('http://localhost:8080')
    expect(searxngEndpoint({ providers: { searxng: { endpoint: '' } } })).toBe('http://localhost:8080')
    expect(searxngEndpoint({ providers: { searxng: { endpoint: 'http://127.0.0.1:9090/' } } })).toBe('http://127.0.0.1:9090')
  })

  it('health timeout is small (startup must not wait)', () => {
    expect(SEARXNG_HEALTH_TIMEOUT_MS).toBeLessThanOrEqual(1000)
  })
})

describe('searxngAlive (mocked fetch)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    const mock = vi.fn(impl)
    globalThis.fetch = mock as unknown as typeof globalThis.fetch
    return mock
  }

  it('200 → alive, one GET to {endpoint}/healthz', async () => {
    const mock = stubFetch(async () => new Response('OK', { status: 200 }))
    await expect(searxngAlive('http://127.0.0.1:8080')).resolves.toBe(true)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/healthz')
  })

  it('500 / non-2xx → not alive', async () => {
    stubFetch(async () => new Response('err', { status: 500 }))
    await expect(searxngAlive('http://127.0.0.1:8080')).resolves.toBe(false)
  })

  it('network failure → not alive (no throw)', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(searxngAlive('http://127.0.0.1:8080')).resolves.toBe(false)
  })

  it('hang → aborted within the timeout, not alive', async () => {
    stubFetch(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const started = Date.now()
    await expect(searxngAlive('http://127.0.0.1:8080')).resolves.toBe(false)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('session_start health-check (real host, mocked fetch)', () => {
  let agentDir: string
  const savedEnv = process.env.PI_CODING_AGENT_DIR
  const originalFetch = globalThis.fetch
  const savedDepth = process.env.PI_SUBAGENT_DEPTH

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'aws-pi-searxng-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
    delete process.env.PI_SUBAGENT_DEPTH
  })
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH
    else process.env.PI_SUBAGENT_DEPTH = savedDepth
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    await rm(agentDir, { recursive: true, force: true })
  })

  function makeCtx(notifications: Array<{ message: string; level: string }> = []): ExtensionContext {
    return {
      hasUI: true,
      ui: {
        confirm: async () => true,
        select: async () => undefined,
        input: async () => undefined,
        notify: (message: string, level: string) => { notifications.push({ message, level }) },
        setStatus: () => {},
        theme: { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s, bold: (s: string) => s },
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

  function build(config: PiConfig) {
    const handlers: Record<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>> = {}
    const appended: Array<{ type: string; data: unknown }> = []
    const pi = {
      registerTool: () => {},
      on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
        handlers[event] ??= []
        handlers[event].push(handler)
        return () => {}
      },
      registerFlag: () => {},
      registerCommand: () => {},
      getFlag: () => false,
      appendEntry: (type: string, data?: unknown) => { appended.push({ type, data }) },
    }
    buildPiWebStack(pi as unknown as ExtensionAPI, config)
    return { handlers, appended }
  }

  async function fireStartup(handlers: ReturnType<typeof build>['handlers'], ctx: ExtensionContext): Promise<void> {
    await handlers.session_start?.[0]?.({ reason: 'startup' }, ctx)
  }

  it('default config (engines unset): one probe on startup', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('OK', { status: 200 }))
    globalThis.fetch = mock as unknown as typeof globalThis.fetch
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers } = build({})
    await fireStartup(handlers, makeCtx(notifications))
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1), { timeout: 2_000 })
    expect(mock.mock.calls[0]?.[0]).toBe('http://localhost:8080/healthz')
    await new Promise((r) => setTimeout(r, 50)) // let the .then() settle: healthy → silence
    // browser-readiness side effects (CI machines have no Chromium) are
    // irrelevant here — only SearXNG notifications count
    expect(notifications.filter((n) => n.message.includes('SearXNG недоступен'))).toEqual([])
  })

  it('dead instance: one warning, one session-log entry, endpoint and install hint', async () => {
    const mock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    globalThis.fetch = mock as unknown as typeof globalThis.fetch
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers, appended } = build({})
    await fireStartup(handlers, makeCtx(notifications))
    await vi.waitFor(() => expect(notifications).toHaveLength(1), { timeout: 2_000 })
    const [note] = notifications
    expect(note?.level).toBe('warning')
    expect(note?.message).toContain('agents-web-search: SearXNG недоступен на http://localhost:8080')
    expect(note?.message).toContain('install.sh')
    // one probe only (not repeated per notification)
    expect(mock).toHaveBeenCalledTimes(1)
    // the model-facing path: a session-log entry records the dead instance
    // (browser-readiness entries, if any on a machine without Chromium,
    // are filtered out)
    const searxngEntries = appended.filter((e) => e.type === 'web-search-searxng-down')
    expect(searxngEntries).toHaveLength(1)
    expect(searxngEntries[0]?.data).toEqual({ endpoint: 'http://localhost:8080' })
  })

  it('searxng not in engines: no probe at all', async () => {
    const mock = vi.fn(async () => new Response('OK', { status: 200 }))
    globalThis.fetch = mock as unknown as typeof globalThis.fetch
    const { handlers } = build({ search: { engines: ["ddg", "bing"] } })
    await fireStartup(handlers, makeCtx([]))
    await new Promise((r) => setTimeout(r, 100))
    expect(mock).not.toHaveBeenCalled()
  })

  it('custom endpoint from providers.searxng.endpoint is probed', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('OK', { status: 200 }))
    globalThis.fetch = mock as unknown as typeof globalThis.fetch
    const { handlers } = build({ providers: { searxng: { endpoint: "http://127.0.0.1:9090" } } })
    await fireStartup(handlers, makeCtx([]))
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1), { timeout: 2_000 })
    expect(mock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9090/healthz')
  })

  it('subagent process (PI_SUBAGENT_DEPTH > 0): no probe, no side effects', async () => {
    process.env.PI_SUBAGENT_DEPTH = '1'
    const mock = vi.fn(async () => new Response('OK', { status: 200 }))
    globalThis.fetch = mock as unknown as typeof globalThis.fetch
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers } = build({})
    await fireStartup(handlers, makeCtx(notifications))
    await new Promise((r) => setTimeout(r, 100))
    expect(mock).not.toHaveBeenCalled()
    expect(notifications).toEqual([])
  })

  it('non-startup reasons (resume/reload) do not probe', async () => {
    const mock = vi.fn(async () => new Response('OK', { status: 200 }))
    globalThis.fetch = mock as unknown as typeof globalThis.fetch
    const { handlers } = build({})
    const ctx = makeCtx([])
    await handlers.session_start?.[0]?.({ reason: 'resume' }, ctx)
    await handlers.session_start?.[0]?.({ reason: 'reload' }, ctx)
    await new Promise((r) => setTimeout(r, 100))
    expect(mock).not.toHaveBeenCalled()
  })
})
