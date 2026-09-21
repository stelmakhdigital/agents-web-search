import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { credentials, homePathsHolder, launchEnvironment, makeCtx, schemastery, tools, web } from './host-mocks.ts'

const holder = vi.hoisted(() => ({ baseDir: '' }))
beforeEach(() => {
  holder.baseDir = mkdtempSync(join(tmpdir(), 'aws-dsh-host-'))
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

import { CoreError } from '@agents-web-search/core'
import { buildDshWebStack, toHostError } from '../src/host.ts'

const config = () => ({ search: { storePath: join(holder.baseDir, 'web.db') } })

describe('buildDshWebStack (real core, mocked host modules)', () => {
  it('creates the stack and registers exactly the adapter tools', () => {
    const { ctx, registered } = makeCtx()
    const result = buildDshWebStack(ctx as never, config())
    expect(result.stack.config.store.path).toBe(join(holder.baseDir, 'web.db'))
    expect(result.stack.config.search.engines).toEqual(['ddg', 'bing'])
    const names = registered.tools.map(t => t.name)
    expect(names).toEqual(['get_search_content', 'web_platform_search', 'web_history', 'web_search_stats', 'web_cache_clear'])
    // The real core's web_history schema projected to DSH (min/max dropped, enum kept).
    const history = registered.tools.find(t => t.name === 'web_history') as { parameters: Record<string, unknown> }
    expect(history.parameters).toMatchObject({
      kind: { type: 'string', enum: ['search', 'fetch', 'all'] },
      limit: { type: 'integer' },
    })
    result.disposeTools()
    void result.stack.dispose()
  })

  it('resolves credentials: credentials domain → launch environment (per-search)', async () => {
    const asked = new Set<string>()
    const { ctx } = makeCtx({
      credentials: { resolve: async (ref: string) => { asked.add(ref); return { value: 'from-credentials', source: 'domain' } } },
    })
    const { host } = buildDshWebStack(ctx as never, config())
    expect(await host.credential('websearch:exa')).toBe('from-credentials')
    expect(asked).toContain('EXA_API_KEY')
    void host.dispose?.()
  })

  it('falls back to the launch environment without a credentials service', async () => {
    const envNames: string[] = []
    const { ctx } = makeCtx({
      launchEnv: { get: (name: string) => { envNames.push(name); return { value: `env-${name}` } } },
    })
    const { host } = buildDshWebStack(ctx as never, config())
    expect(await host.credential('websearch:openai')).toBe('env-OPENAI_API_KEY')
    expect(await host.credential('websearch:unknown-engine')).toBeUndefined()
    void host.dispose?.()
  })

  it('honors a configured apiKeyEnv override', async () => {
    const envNames: string[] = []
    const { ctx } = makeCtx({
      launchEnv: { get: (name: string) => { envNames.push(name); return { value: `env-${name}` } } },
    })
    const { host } = buildDshWebStack(
      ctx as never,
      { ...config(), providers: { exa: { apiKeyEnv: 'MY_EXA_KEY' } } },
    )
    expect(await host.credential('websearch:exa')).toBe('env-MY_EXA_KEY')
    expect(envNames).toContain('MY_EXA_KEY')
    void host.dispose?.()
  })

  it('maps core errors to WebError (parity codes)', () => {
    const mapped = toHostError(new CoreError('boom', 'WEB_SEARCH_TIMEOUT', new Error('cause')))
    expect(mapped).toBeInstanceOf(Error)
    expect((mapped as { code: string }).code).toBe('WEB_SEARCH_TIMEOUT')
    expect((mapped as { message: string }).message).toBe('boom')
    const unknown = toHostError(new Error('other'))
    expect((unknown as { code: string }).code).toBe('WEB_INTERNAL')
  })

  it('approve: fail-closed without an exec context or an approval service', async () => {
    const { ctx } = makeCtx()
    const { host, withExec } = buildDshWebStack(ctx as never, config())
    const request = { kind: 'browser_navigate', description: 'Navigate to https://example.com/' } as const
    await expect(host.approve?.(request as never)).rejects.toMatchObject({ code: 'BROWSER_APPROVAL_UNAVAILABLE' })
    const exec = { agent: 'agent-1', callId: 'call-1', signal: new AbortController().signal } as never
    await expect(withExec(exec, () => host.approve?.(request as never))).rejects.toMatchObject({
      code: 'BROWSER_APPROVAL_UNAVAILABLE',
    })
    void host.dispose?.()
  })

  it('approve: delegates to the host approval service (allow + deny)', async () => {
    const requests: unknown[] = []
    const { ctx } = makeCtx({
      approval: {
        request: async (params: unknown) => {
          requests.push(params)
          return requests.length === 1 ? 'allowed-once' : 'denied'
        },
      },
    })
    const { host, withExec } = buildDshWebStack(ctx as never, config())
    const exec = { agent: 'agent-1', callId: 'call-1', signal: new AbortController().signal } as never
    const request = { kind: 'browser_navigate', description: 'Navigate to https://example.com/' } as const
    expect(await withExec(exec, () => host.approve?.(request as never))).toBe(true)
    expect(await withExec(exec, () => host.approve?.(request as never))).toBe(false)
    expect(requests[0]).toMatchObject({ agent: 'agent-1', toolName: 'browser_navigate', callId: 'call-1' })
    void host.dispose?.()
  })

  it('runs a real core tool through the DSH wrapper (execute bridge)', async () => {
    const { ctx, registered } = makeCtx()
    const { host } = buildDshWebStack(ctx as never, config())
    const history = registered.tools.find(t => t.name === 'web_history') as {
      execute: (args: unknown, exec: unknown) => Promise<{ text: string }>
    }
    const exec = { callId: 'c1', name: 'web_history', agent: 'agent-1', signal: new AbortController().signal }
    const out = await history.execute({ kind: 'all', limit: 5 }, exec)
    expect(typeof out.text).toBe('string')
    // The core tool recorded a search-free store read without error (no history yet).
    expect(out.text).toMatch(/No matching history entries/)
    expect(host.identity.name).toBe('dsh')
    void host.dispose?.()
  })

  it('dispose closes the store (the effect disposer chain)', async () => {
    const { ctx } = makeCtx()
    const result = buildDshWebStack(ctx as never, config())
    await result.stack.dispose()
    await result.host.dispose?.()
    result.disposeTools()
    // No throw = the store closed cleanly (a second dispose is a no-op).
    await result.stack.dispose()
  })
})
