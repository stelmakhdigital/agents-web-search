import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { browserReadiness } from '@agents-web-search/core'
import { buildPiWebStack } from '../src/host.ts'
import type { PiConfig } from '../src/config.ts'

describe('session_start browser readiness (real host, real probe)', () => {
  let agentDir: string
  const savedEnv = process.env.PI_CODING_AGENT_DIR
  const savedDepth = process.env.PI_SUBAGENT_DEPTH

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'aws-pi-browser-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
    delete process.env.PI_SUBAGENT_DEPTH
  })
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    if (savedDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH
    else process.env.PI_SUBAGENT_DEPTH = savedDepth
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

  it('browser enabled (default): the setup entry appears exactly when the host is not ready', async () => {
    const expected = await browserReadiness()
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers, appended } = build({})
    await handlers.session_start?.[0]?.({ reason: 'startup' }, makeCtx(notifications))
    if (expected.hint === undefined) {
      await new Promise((r) => setTimeout(r, 100))
      expect(appended).toEqual([])
      expect(notifications).toEqual([])
    } else {
      await vi.waitFor(() => expect(appended).toHaveLength(1), { timeout: 3_000 })
      expect(appended[0]?.type).toBe('web-search-browser-setup')
      expect(appended[0]?.data).toEqual({ hint: expected.hint })
      expect(notifications).toHaveLength(1)
      expect(notifications[0]?.message).toContain('браузер недоступен')
      expect(notifications[0]?.level).toBe('warning')
    }
  })

  it('browser disabled: no readiness probe side effects', async () => {
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers, appended } = build({ browser: { enabled: false } })
    await handlers.session_start?.[0]?.({ reason: 'startup' }, makeCtx(notifications))
    await new Promise((r) => setTimeout(r, 100))
    expect(appended).toEqual([])
    expect(notifications).toEqual([])
  })

  it('non-startup reasons (resume/reload) do not probe', async () => {
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers, appended } = build({})
    const ctx = makeCtx(notifications)
    await handlers.session_start?.[0]?.({ reason: 'resume' }, ctx)
    await handlers.session_start?.[0]?.({ reason: 'reload' }, ctx)
    await new Promise((r) => setTimeout(r, 100))
    expect(appended).toEqual([])
    expect(notifications).toEqual([])
  })

  it('subagent process: no probe side effects', async () => {
    process.env.PI_SUBAGENT_DEPTH = '1'
    const notifications: Array<{ message: string; level: string }> = []
    const { handlers, appended } = build({})
    await handlers.session_start?.[0]?.({ reason: 'startup' }, makeCtx(notifications))
    await new Promise((r) => setTimeout(r, 100))
    expect(appended).toEqual([])
    expect(notifications).toEqual([])
  })
})
