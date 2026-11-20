/**
 * browser.autoDownload wiring: mocked core probe/installer drive the
 * session_start background-install paths deterministically (real downloads
 * belong to the live machine, not CI). Module state (`browserProbeFired`) is
 * process-level, so each test re-imports the host after resetModules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

type Readiness = { playwright: boolean; chromium: boolean; hint?: string }

let readinessQueue: Readiness[] = []
let installCalls = 0
let installResult: { ok: boolean; error?: string } = { ok: true }

vi.mock('@agents-web-search/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@agents-web-search/core')>()
  return {
    ...original,
    browserReadiness: async () => readinessQueue.length > 1 ? (readinessQueue.shift() as Readiness) : (readinessQueue[0] as Readiness),
    installChromium: async () => {
      installCalls += 1
      return installResult
    },
  }
})

const NOT_DOWNLOADED: Readiness = {
  playwright: true,
  chromium: false,
  hint: 'the playwright package is installed, but the Chromium browser is not downloaded — run `npx playwright install chromium`',
}
const READY: Readiness = { playwright: true, chromium: true }

async function build(config: Record<string, unknown>) {
  vi.resetModules()
  const { buildPiWebStack } = await import('../src/host.ts')
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
  buildPiWebStack(pi as unknown as ExtensionAPI, config as never)
  const notifications: Array<{ message: string; level: string }> = []
  const ctx = {
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
  } as unknown as ExtensionContext
  return { handlers, appended, notifications, ctx }
}

describe('session_start browser.autoDownload', () => {
  let agentDir: string
  const savedEnv = process.env.PI_CODING_AGENT_DIR
  const savedDepth = process.env.PI_SUBAGENT_DEPTH

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'aws-pi-ad-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
    delete process.env.PI_SUBAGENT_DEPTH
    readinessQueue = [NOT_DOWNLOADED]
    installCalls = 0
    installResult = { ok: true }
  })
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH
    else process.env.PI_SUBAGENT_DEPTH = savedDepth
    await rm(agentDir, { recursive: true, force: true })
  })

  it('binary missing + autoDownload (default): background install, then success notice', async () => {
    readinessQueue = [NOT_DOWNLOADED, READY]
    const { handlers, appended, notifications, ctx } = await build({})
    await handlers.session_start?.[0]?.({ reason: 'startup' }, ctx)
    await vi.waitFor(() => expect(installCalls).toBe(1), { timeout: 3_000 })
    await vi.waitFor(
      () => expect(notifications.some((n) => n.message.includes('Chromium установлен'))).toBe(true),
      { timeout: 3_000 },
    )
    expect(notifications.some((n) => n.message.includes('скачиваю в фоне'))).toBe(true)
    expect(appended.some((e) => e.type === 'web-search-browser-setup' && JSON.stringify(e.data) === '{"installed":true}')).toBe(true)
  })

  it('autoDownload false: no install, warning carries the absolute installer command', async () => {
    const { handlers, notifications, ctx } = await build({ browser: { autoDownload: false } })
    await handlers.session_start?.[0]?.({ reason: 'startup' }, ctx)
    await vi.waitFor(() => expect(notifications.filter((n) => n.message.includes('браузер недоступен')).length).toBe(1), { timeout: 3_000 })
    expect(installCalls).toBe(0)
    expect(notifications.some((n) => n.message.includes('browser/install.sh') && n.message.includes('bash'))).toBe(true)
  })

  it('install failure: warning with the manual command, no second probe', async () => {
    installResult = { ok: false, error: 'network down' }
    readinessQueue = [NOT_DOWNLOADED]
    const { handlers, appended, notifications, ctx } = await build({})
    await handlers.session_start?.[0]?.({ reason: 'startup' }, ctx)
    await vi.waitFor(() => expect(installCalls).toBe(1), { timeout: 3_000 })
    await vi.waitFor(() => expect(notifications.some((n) => n.message.includes('не удалось скачать Chromium'))).toBe(true), { timeout: 3_000 })
    expect(notifications.some((n) => n.message.includes('browser/install.sh'))).toBe(true)
    expect(appended.some((e) => JSON.stringify(e.data)?.includes('network down'))).toBe(true)
  })

  it('installed but libraries still missing: re-probe warning (root layer stays manual)', async () => {
    readinessQueue = [NOT_DOWNLOADED, { playwright: true, chromium: true, hint: 'system libraries are missing (libnss3.so) — run `npx playwright install --with-deps chromium`' }]
    const { handlers, appended, notifications, ctx } = await build({})
    await handlers.session_start?.[0]?.({ reason: 'startup' }, ctx)
    await vi.waitFor(() => expect(notifications.some((n) => n.message.includes('браузер недоступен') && n.message.includes('--with-deps'))).toBe(true), { timeout: 3_000 })
    expect(appended.some((e) => JSON.stringify(e.data)?.includes('--with-deps'))).toBe(true)
  })
})
