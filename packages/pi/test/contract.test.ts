/**
 * Pi adapter against the shared host contract (roadmap 4.6):
 * `buildPiWebStack` + a mocked `ExtensionAPI`, normalized onto
 * `ContractHandles`. The suite's expectations come from
 * `@agents-web-search/contract` (host-agnostic).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, vi } from 'vitest'

import { runHostContractTests, type ContractConfig, type ContractHandles, type ContractToolResult } from '@agents-web-search/contract'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { buildPiWebStack } from '../src/host.ts'
import type { PiConfig } from '../src/config.ts'

const CORE_ERROR_TEXT = /^Error \(([A-Z0-9_]+)\): ([\s\S]*)$/

interface PiTool {
  name: string
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>
}

function makeMockPi() {
  const tools: PiTool[] = []
  const pi = {
    registerTool: vi.fn((tool: PiTool) => {
      tools.push(tool)
    }),
    on: vi.fn(() => () => {}),
  }
  return { pi: pi as unknown as ExtensionAPI, tools }
}

function makeCtx(): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      confirm: async () => false,
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

async function build(config: ContractConfig): Promise<ContractHandles> {
  const { pi, tools } = makeMockPi()
  const piConfig: PiConfig = {
    search: { storePath: config.storePath },
    ...(config.browserEnabled
      ? { browser: { enabled: true, approval: config.approval === undefined ? 'navigate' : config.approval } }
      : { browser: { enabled: false } }),
  }
  const result = buildPiWebStack(pi, piConfig)

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ContractToolResult> => {
    const tool = tools.find(t => t.name === name)
    if (tool === undefined) throw new Error(`Pi harness: tool ${name} is not registered`)
    try {
      const out = await tool.execute('contract-id', args, new AbortController().signal, undefined, makeCtx())
      const text = out.content.map(c => c.text).join('\n')
      return { ok: true, text }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const match = CORE_ERROR_TEXT.exec(message)
      return { ok: false, text: message, code: match?.[1] }
    }
  }

  return {
    host: result.host,
    stack: result.stack,
    callTool,
    approve: (kind: string, description: string) =>
      result.host.approve === undefined
        ? Promise.resolve(false)
        : result.host.approve({ kind, description }),
    dispose: async () => {
      result.disposeTools()
      await result.dispose()
    },
  }
}

describe('Pi host contract', () => {
  // Isolate the agent dir (getAgentDir) so the suite never touches ~/.pi.
  const savedEnv = process.env.PI_CODING_AGENT_DIR
  let agentDir: string
  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'aws-pi-contract-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
  })
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    await rm(agentDir, { recursive: true, force: true })
  })

  runHostContractTests({
    label: 'Pi',
    build,
  })
})
