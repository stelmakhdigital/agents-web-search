/**
 * DSH adapter against the shared host contract (roadmap 4.6):
 * `buildDshWebStack` + the mocked DSH runtime, normalized onto
 * `ContractHandles`. The suite's expectations come from
 * `@agents-web-search/contract` (host-agnostic).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'

import { runHostContractTests, type ContractConfig, type ContractHandles, type ContractToolResult } from '@agents-web-search/contract'
import { credentials, homePathsHolder, launchEnvironment, makeCtx, schemastery, tools, web } from './host-mocks.ts'
import { buildDshWebStack } from '../src/host.ts'
import type { Config } from '../src/config.ts'

const holder = vi.hoisted(() => ({ baseDir: '' }))
beforeEach(() => {
  holder.baseDir = mkdtempSync(join(tmpdir(), 'aws-dsh-contract-'))
})
afterEach(() => {
  rmSync(holder.baseDir, { recursive: true, force: true })
})

vi.mock('@deepseek-ai/schemastery', () => schemastery())
vi.mock('@deepseek-ai/dsh-credentials', () => credentials())
vi.mock('@deepseek-ai/dsh-home-paths', () => homePathsHolder(holder))
vi.mock('@deepseek-ai/dsh-launch-environment', () => launchEnvironment())
vi.mock('@deepseek-ai/dsh-tools', () => tools())
vi.mock('@deepseek-ai/dsh-web', () => web())

const EXEC = { callId: 'contract', name: 'web_history', agent: 'agent-contract', signal: new AbortController().signal } as never

function dshConfig(config: ContractConfig): Config {
  return {
    search: { storePath: config.storePath },
    browser: {
      enabled: config.browserEnabled,
      approval: config.approval === undefined ? 'navigate' : config.approval,
    },
  } as Config
}

function build(config: ContractConfig): ContractHandles {
  const { ctx, registered } = makeCtx()
  const result = buildDshWebStack(ctx as never, dshConfig(config))

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ContractToolResult> => {
    const tool = registered.tools.find(t => t.name === name) as
      | { execute: (a: unknown, e: unknown) => Promise<{ text: string }> }
      | undefined
    if (tool === undefined) throw new Error(`DSH harness: tool ${name} is not registered`)
    try {
      const out = await tool.execute(args, EXEC)
      return { ok: true, text: out.text }
    } catch (error) {
      const err = error as { code?: string; message?: string }
      return { ok: false, text: err.message ?? String(error), code: err.code }
    }
  }

  return {
    host: result.host,
    stack: result.stack,
    callTool,
    approve: (kind: string, description: string) =>
      result.withExec(EXEC, () =>
        result.host.approve === undefined
          ? Promise.resolve(false)
          : result.host.approve({ kind, description } as never),
      ) as Promise<boolean>,
    dispose: async () => {
      result.disposeTools()
      await result.stack.dispose()
    },
  }
}

runHostContractTests({
  label: 'DSH',
  build,
})
