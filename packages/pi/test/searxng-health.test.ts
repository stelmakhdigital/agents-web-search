import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

// The systemd autostart path spawns systemctl; mock it process-wide for
// this file — startLocalSearxng is the only consumer.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

import { spawn } from 'node:child_process'
import { buildPiWebStack } from '../src/host.ts'
import {
  SEARXNG_HEALTH_TIMEOUT_MS,
  SEARXNG_LAUNCHD_LABEL,
  SEARXNG_UNIT_NAME,
  isLoopbackEndpoint,
  searxngAlive,
  searxngEndpoint,
  searxngInEngines,
  searxngServiceFile,
  searxngUnitFile,
  startLocalSearxng,
} from '../src/searxng-health.ts'
import type { PiConfig } from '../src/config.ts'

const mockSpawn = vi.mocked(spawn)

// process.platform stub: the systemd tests must exercise the systemd branch
// even on macOS CI/dev hosts (and vice versa). Restored in afterEach of each
// describe that uses it.
const savedPlatformDesc = Object.getOwnPropertyDescriptor(process, 'platform')
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true, writable: false })
}
function restorePlatform(): void {
  if (savedPlatformDesc) Object.defineProperty(process, 'platform', savedPlatformDesc)
}

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

  it('isLoopbackEndpoint: only loopback hosts autostart', () => {
    expect(isLoopbackEndpoint('http://localhost:8080')).toBe(true)
    expect(isLoopbackEndpoint('http://127.0.0.1:8080')).toBe(true)
    expect(isLoopbackEndpoint('http://searx.internal:8080')).toBe(false)
    expect(isLoopbackEndpoint('not a url')).toBe(false)
  })
})

describe('startLocalSearxng (systemd autostart)', () => {
  let xdgDir: string
  const savedXdg = process.env.XDG_CONFIG_HOME

  beforeEach(async () => {
    setPlatform('linux')
    xdgDir = await mkdtemp(join(tmpdir(), 'aws-searxng-xdg-'))
    process.env.XDG_CONFIG_HOME = xdgDir
    mockSpawn.mockReset()
  })
  afterEach(async () => {
    restorePlatform()
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    await rm(xdgDir, { recursive: true, force: true })
  })

  async function installFakeUnit(): Promise<void> {
    await mkdir(join(xdgDir, 'systemd', 'user'), { recursive: true })
    await writeFile(searxngUnitFile(), '[Unit]\nDescription=fake\n')
  }

  function spawnOnce(code: number | null): void {
    mockSpawn.mockImplementation(() => {
      const child = new EventEmitter()
      setTimeout(() => child.emit('close', code), 5)
      return child as never
    })
  }

  it('unit file absent (never installed): false, systemctl is never spawned', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('down') }) as never
    await expect(startLocalSearxng('http://localhost:8080')).resolves.toBe('skipped')
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('unit present + start succeeds + health answers: true, systemctl args exact', async () => {
    await installFakeUnit()
    spawnOnce(0)
    globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 })) as never
    await expect(startLocalSearxng('http://localhost:8080')).resolves.toBe('up')
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn.mock.calls[0]?.[0]).toBe('systemctl')
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual(['--user', 'start', SEARXNG_UNIT_NAME])
  })

  it('systemctl exits non-zero: false', async () => {
    await installFakeUnit()
    spawnOnce(3)
    globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 })) as never
    await expect(startLocalSearxng('http://localhost:8080')).resolves.toBe('failed')
  })

  it('start ok but health never answers within the budget: false', async () => {
    await installFakeUnit()
    spawnOnce(0)
    globalThis.fetch = vi.fn(async () => { throw new Error('still down') }) as never
    await expect(startLocalSearxng('http://localhost:8080', 300)).resolves.toBe('failed')
  })
})

describe('startLocalSearxng (macOS launchd autostart)', () => {
  let home: string
  const savedHome = process.env.HOME

  beforeEach(async () => {
    setPlatform('darwin')
    home = await mkdtemp(join(tmpdir(), 'aws-searxng-home-'))
    process.env.HOME = home
    mockSpawn.mockReset()
  })
  afterEach(async () => {
    restorePlatform()
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    await rm(home, { recursive: true, force: true })
  })

  function spawnOnce(code: number | null): void {
    mockSpawn.mockImplementation(() => {
      const child = new EventEmitter()
      setTimeout(() => child.emit('close', code), 5)
      return child as never
    })
  }

  it('serviceFile (darwin): LaunchAgent plist under ~/Library/LaunchAgents', () => {
    expect(searxngServiceFile('darwin').endsWith(join('Library', 'LaunchAgents', SEARXNG_LAUNCHD_LABEL + '.plist'))).toBe(true)
    expect(searxngServiceFile('linux')).toBe(searxngUnitFile())
  })

  it('plist absent: skipped, launchctl never spawned', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('down') }) as never
    await expect(startLocalSearxng('http://localhost:8080', 300, 'darwin')).resolves.toBe('skipped')
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('plist present: bootstrap + kickstart, health up', async () => {
    await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true })
    await writeFile(searxngServiceFile('darwin'), '<plist/>')
    spawnOnce(0)
    globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 })) as never
    await expect(startLocalSearxng('http://localhost:8080', 300, 'darwin')).resolves.toBe('up')
    const cmds = mockSpawn.mock.calls.map((c) => c[0])
    expect(cmds).toEqual(['launchctl', 'launchctl'])
    expect(mockSpawn.mock.calls[0]?.[1]?.[0]).toBe('bootstrap')
    expect(mockSpawn.mock.calls[1]?.[1]?.[0]).toBe('kickstart')
  })

  it('bootstrap loads the job (RunAtLoad starts it) even when kickstart fails: up', async () => {
    await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true })
    await writeFile(searxngServiceFile('darwin'), '<plist/>')
    mockSpawn
      .mockImplementationOnce(() => { const c = new EventEmitter(); setTimeout(() => c.emit('close', 0), 5); return c as never }) // bootstrap ok
      .mockImplementationOnce(() => { const c = new EventEmitter(); setTimeout(() => c.emit('close', 1), 5); return c as never }) // kickstart: job still spawning — fine, RunAtLoad covers it
    globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 })) as never
    await expect(startLocalSearxng('http://localhost:8080', 300, 'darwin')).resolves.toBe('up')
  })

  it('bootstrap and kickstart both fail (x3): failed', async () => {
    await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true })
    await writeFile(searxngServiceFile('darwin'), '<plist/>')
    spawnOnce(1)
    globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200 })) as never
    await expect(startLocalSearxng('http://localhost:8080', 300, 'darwin')).resolves.toBe('failed')
    expect(mockSpawn).toHaveBeenCalledTimes(6) // 3 retries x (bootstrap + kickstart)
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
  let xdgDir: string
  const savedEnv = process.env.PI_CODING_AGENT_DIR
  const savedXdg = process.env.XDG_CONFIG_HOME
  const originalFetch = globalThis.fetch
  const savedDepth = process.env.PI_SUBAGENT_DEPTH

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'aws-pi-searxng-'))
    // Empty XDG dir: the systemd unit is "never installed" here, so the
    // health-check keeps its warn-only behavior (autostart 'skipped').
    xdgDir = await mkdtemp(join(tmpdir(), 'aws-pi-searxng-xdg-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
    process.env.XDG_CONFIG_HOME = xdgDir
    delete process.env.PI_SUBAGENT_DEPTH
    mockSpawn.mockReset()
  })
  afterEach(async () => {
    restorePlatform()
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH
    else process.env.PI_SUBAGENT_DEPTH = savedDepth
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    await rm(agentDir, { recursive: true, force: true })
    await rm(xdgDir, { recursive: true, force: true })
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

describe('session_start autostart (real host, mocked systemctl)', () => {
  let agentDir: string
  let xdgDir: string
  const savedEnv = process.env.PI_CODING_AGENT_DIR
  const savedXdg = process.env.XDG_CONFIG_HOME
  const savedDepth = process.env.PI_SUBAGENT_DEPTH

  beforeEach(async () => {
    setPlatform('linux') // this describe exercises the systemd host path
    agentDir = await mkdtemp(join(tmpdir(), 'aws-searxng-host-'))
    xdgDir = await mkdtemp(join(tmpdir(), 'aws-searxng-xdg-host-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
    process.env.XDG_CONFIG_HOME = xdgDir
    delete process.env.PI_SUBAGENT_DEPTH
    mockSpawn.mockReset()
  })
  afterEach(async () => {
    restorePlatform()
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH
    else process.env.PI_SUBAGENT_DEPTH = savedDepth
    await rm(agentDir, { recursive: true, force: true })
    await rm(xdgDir, { recursive: true, force: true })
  })

  async function installFakeUnit(): Promise<void> {
    await mkdir(join(xdgDir, 'systemd', 'user'), { recursive: true })
    await writeFile(searxngUnitFile(), '[Unit]\nDescription=fake\n')
  }

  function spawnWithCode(code: number | null): void {
    mockSpawn.mockImplementation(() => {
      const child = new EventEmitter()
      setTimeout(() => child.emit('close', code), 5)
      return child as never
    })
  }

  function makeCtx(notifications: Array<{ message: string; level: string }>): ExtensionContext {
    return {
      hasUI: true,
      ui: {
        notify: (message: string, level: string) => { notifications.push({ message, level }) },
        setStatus: () => {},
      },
      mode: 'tui',
      hasUI_: true,
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

  it('dead instance + autostart (default ON): systemd brings it up → info note, no down entry', async () => {
    await installFakeUnit()
    spawnWithCode(0)
    let probe = 0
    globalThis.fetch = vi.fn(async () => {
      probe += 1
      if (probe === 1) throw new Error('ECONNREFUSED') // the session_start probe
      return new Response('OK', { status: 200 }) // the post-start health poll
    }) as never
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers, appended } = build({})
    await handlers.session_start?.[0]?.({ reason: 'startup' }, makeCtx(notifications))
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1), { timeout: 3_000 })
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual(['--user', 'start', 'searxng.service'])
    await vi.waitFor(
      () => expect(notifications.some((n) => n.level === 'info' && n.message.includes('поднят автоматически'))).toBe(true),
      { timeout: 3_000 },
    )
    expect(appended.filter((e) => e.type === 'web-search-searxng-down')).toEqual([])
  })

  it('autostart false: no systemctl, warning-only path', async () => {
    await installFakeUnit()
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as never
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers, appended } = build({ searxng: { autostart: false } })
    await handlers.session_start?.[0]?.({ reason: 'startup' }, makeCtx(notifications))
    await vi.waitFor(() => expect(notifications.filter((n) => n.message.includes('SearXNG недоступен'))).toHaveLength(1), { timeout: 2_000 })
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(notifications.filter((n) => n.message.includes('автозапуск'))).toEqual([])
    expect(appended.filter((e) => e.type === 'web-search-searxng-down')).toHaveLength(1)
  })

  it('systemctl fails (exit non-zero): warning mentions the failed autostart', async () => {
    await installFakeUnit()
    spawnWithCode(1)
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as never
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers } = build({})
    await handlers.session_start?.[0]?.({ reason: 'startup' }, makeCtx(notifications))
    await vi.waitFor(
      () => expect(notifications.some((n) => n.message.includes('автозапуск через сервис-менеджер не помог'))).toBe(true),
      { timeout: 3_000 },
    )
  })

  it('remote endpoint is never autostarted', async () => {
    await installFakeUnit()
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as never
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers } = build({ providers: { searxng: { endpoint: 'https://searx.example.com' } } })
    await handlers.session_start?.[0]?.({ reason: 'startup' }, makeCtx(notifications))
    await vi.waitFor(() => expect(notifications.filter((n) => n.message.includes('SearXNG недоступен'))).toHaveLength(1), { timeout: 2_000 })
    expect(mockSpawn).not.toHaveBeenCalled()
  })
})
