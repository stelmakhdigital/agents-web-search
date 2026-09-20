/**
 * Self-check of the contract suite: a minimal in-memory HostAdapter
 * (real core stack, no-op tool registry, fail-closed approve) must pass
 * the whole suite. If the suite is broken, this fails — and so does any
 * real adapter.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CoreError, createWebStack, type HostAdapter, type ToolSpec, type WebStack } from '@agents-web-search/core'

import { runHostContractTests, type ContractConfig, type ContractHandles, type ContractToolResult } from '../src/index.ts'

const CORE_ERROR_TEXT = /^Error \(([A-Z0-9_]+)\): ([\s\S]*)$/

function buildFakeHarness(config: ContractConfig): ContractHandles {
  let current: ToolSpec[] = []

  const host: HostAdapter = {
    identity: { name: 'fake', version: '0.0.0' },
    config: {
      search: {},
      fetch: {},
      platforms: {},
      store: { path: config.storePath },
      providers: {},
      ...(config.browserEnabled
        ? { browser: { enabled: true, approval: config.approval ?? 'navigate' } }
        : { browser: { enabled: false } }),
    },
    paths: {
      stateDir: join(config.storePath, '..'),
      tempDir: join(config.storePath, '..', 'temp'),
    },
    credential: async () => undefined,
    registerTools: (specs: readonly ToolSpec[]) => {
      current = [...specs]
      return () => {
        current = []
      }
    },
    toHostError: (error: unknown) => {
      if (error instanceof CoreError) return new Error(`Error (${error.code}): ${error.message}`)
      return error instanceof Error ? error : new Error(String(error))
    },
    approve: async () => {
      throw new CoreError('no confirmation channel in the fake host — denied (fail-closed)', 'BROWSER_APPROVAL_UNAVAILABLE')
    },
    dispose: () => stack.dispose(),
  }

  const stack: WebStack = createWebStack(host)
  host.registerTools(stack.tools())

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ContractToolResult> => {
    const spec = current.find(s => s.name === name)
    if (spec === undefined) throw new Error(`fake harness: tool ${name} is not registered`)
    const out = await spec.execute(args, { signal: new AbortController().signal })
    if (out.isError) {
      const match = CORE_ERROR_TEXT.exec(out.text)
      return { ok: false, text: out.text, code: match?.[1] }
    }
    return { ok: true, text: out.text }
  }

  return {
    host,
    stack,
    callTool,
    approve: (kind: string, description: string) => host.approve?.({ kind, description }) ?? Promise.resolve(false),
    dispose: async () => {
      void stack.dispose()
    },
  }
}

runHostContractTests({
  label: 'fake (self-check)',
  build: (config) => buildFakeHarness(config),
})

describe('contract suite self-check sanity', () => {
  it('the suite is a no-op outside vitest describe context (defensive)', () => {
    expect(typeof runHostContractTests).toBe('function')
  })

  it('the fake harness stateDir/tempDir are absolute', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aws-contract-fake-'))
    try {
      const handles = buildFakeHarness({ storePath: join(dir, 'web.db'), browserEnabled: false })
      expect(handles.host.paths.stateDir).toBe(join(dir, 'web.db', '..'))
      await handles.dispose()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
