import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import extension from '../extensions/index.ts'
import { CONFIG_FILE_NAME } from '../src/config.ts'

describe('Pi extension entry (mocked ExtensionAPI)', () => {
  let agentDir: string
  const savedEnv = process.env.PI_CODING_AGENT_DIR

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'aws-pi-entry-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
  })
  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedEnv
    await rm(agentDir, { recursive: true, force: true })
  })

  function mockPi() {
    const toolNames: string[] = []
    const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>()
    const pi = {
      registerTool: vi.fn((tool: { name: string }) => {
        toolNames.push(tool.name)
      }),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
        return () => {}
      }),
    }
    return { pi: pi as unknown as ExtensionAPI, toolNames, handlers }
  }

  it('registers all six core tools and a session_shutdown cleanup', async () => {
    const { pi, toolNames, handlers } = mockPi()
    extension(pi)
    expect(toolNames).toEqual([
      'web_search',
      'web_fetch',
      'web_platform_search',
      'web_history',
      'web_search_stats',
      'web_cache_clear',
    ])
    expect(pi.on).toHaveBeenCalledWith('session_shutdown', expect.any(Function))
    const shutdown = handlers.get('session_shutdown')
    expect(shutdown).toHaveLength(1)
    // invoking it must not throw (idempotent dispose; may return a Promise)
    const result = shutdown?.[0]?.({})
    await Promise.resolve(result).catch(() => {})
  })

  it('honors config file switches (platforms off, browser on)', async () => {
    await writeFile(
      join(agentDir, CONFIG_FILE_NAME),
      JSON.stringify({ platforms: { enabled: false }, browser: { enabled: true } }),
    )
    const { pi, toolNames } = mockPi()
    extension(pi)
    expect(toolNames).not.toContain('web_platform_search')
    expect(toolNames).toContain('browser_navigate')
    expect(toolNames).toHaveLength(13) // 6 core − platform + 8 browser
  })

  it('throws on a malformed config before registering anything', async () => {
    await writeFile(join(agentDir, CONFIG_FILE_NAME), '{ oops')
    const { pi, toolNames } = mockPi()
    expect(() => extension(pi)).toThrow(/cannot parse/)
    expect(toolNames).toEqual([])
  })
})
