import { beforeEach, describe, expect, it, vi } from 'vitest'
import { credentials, launchEnvironment, makeCtx, schemastery, tools, web } from './host-mocks.ts'

const coreState = vi.hoisted(() => ({
  tools: [] as Array<Record<string, unknown>>,
  searchCalls: [] as Array<{ req: unknown; signal?: AbortSignal }>,
  fetchCalls: [] as Array<{ req: unknown; signal?: AbortSignal }>,
  searchImpl: async (_req: unknown) => ({
    content: 'answer',
    sources: [
      { url: 'https://one.example/', title: 'One', snippet: 's1', publishedAt: '2026-01-01T00:00:00Z' },
      { url: 'https://two.example/' },
    ],
    truncated: false,
  }),
  fetchImpl: async (req: unknown) => {
    const url = (req as { url: string }).url
    return {
      url,
      statusCode: 200,
      body: { kind: 'text', content: 'body' },
      truncated: false,
    }
  },
  dispose: () => {
    coreState.disposeCalls++
  },
  disposeCalls: 0,
}))

vi.mock('@agents-web-search/core', () => {
  class CoreError extends Error {
    readonly code: string
    readonly cause?: unknown
    constructor(message: string, code: string, options?: { cause?: unknown }) {
      super(message)
      this.code = code
      this.cause = options?.cause
    }
  }
  return {
    CoreError,
    isCoreError: (value: unknown) => value instanceof CoreError,
    createWebStack: (_host: unknown) => {
      return {
        search: async (req: unknown, signal?: AbortSignal) => {
          coreState.searchCalls.push({ req, signal })
          return coreState.searchImpl(req)
        },
        fetch: async (req: unknown, signal?: AbortSignal) => {
          coreState.fetchCalls.push({ req, signal })
          return coreState.fetchImpl(req)
        },
        tools: () => coreState.tools,
        store: {},
        dispose: () => coreState.dispose(),
      }
    },
  }
})
vi.mock('@deepseek-ai/schemastery', () => schemastery())
vi.mock('@deepseek-ai/dsh-credentials', () => credentials())
vi.mock('@deepseek-ai/dsh-home-paths', () => ({ dshHomePath: (...parts: string[]) => `/fake/dsh-home/${parts.join('/')}` }))
vi.mock('@deepseek-ai/dsh-launch-environment', () => launchEnvironment())
vi.mock('@deepseek-ai/dsh-tools', () => tools())
vi.mock('@deepseek-ai/dsh-web', () => web())

import { apply, inject, name, SEARCH_PROVIDER_ID, toHostError } from '../src/index.ts'

function fakeSpec(name: string, parameters: unknown = {}): Record<string, unknown> {
  return {
    name,
    description: `fake ${name}`,
    parameters,
    execute: async (args: unknown) => ({ text: `ok:${name}`, ...(args !== undefined ? { details: args } : {}) }),
  }
}

describe('@agents-web-search/dsh plugin entry (mocked core + host)', () => {
  beforeEach(() => {
    coreState.tools = [
      fakeSpec('web_search', { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } } }),
      fakeSpec('web_fetch', { type: 'object', properties: { url: { type: 'string' } } }),
      fakeSpec('get_search_content', { type: 'object', properties: { source: { type: 'string' }, id: { type: 'integer' } } }),
      fakeSpec('web_platform_search', { type: 'object', properties: { platform: { type: 'string' } } }),
      fakeSpec('web_history', {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['search', 'fetch', 'all'] }, limit: { type: 'integer' } },
      }),
      fakeSpec('web_search_stats'),
      fakeSpec('web_cache_clear'),
    ]
    coreState.searchCalls = []
    coreState.fetchCalls = []
    coreState.disposeCalls = 0
  })

  it('exports the cordis identity', () => {
    expect(name).toBe('agents-web-search')
    expect(inject).toEqual(['web', 'tools', 'systemPrompt'])
    expect(SEARCH_PROVIDER_ID).toBe('multi')
  })

  it('registers the seam providers with parity ids and projects search results', async () => {
    const { ctx, registered } = makeCtx()
    apply(ctx as never, {})
    expect(registered.searchProviders).toHaveLength(1)
    expect(registered.fetchProviders).toHaveLength(1)
    expect(registered.searchProviders[0]?.id).toBe('multi')
    expect(registered.fetchProviders[0]?.id).toBe('cached-http')
    expect(registered.searchProviders[0]?.available()).toBe(true)

    const result = await registered.searchProviders[0]?.search(
      { query: 'hello', maxResults: 5 } as never,
      undefined,
    )
    expect(coreState.searchCalls[0]?.req).toEqual({ query: 'hello', maxResults: 5 })
    expect(result).toEqual({
      content: 'answer',
      sources: [
        { url: 'https://one.example/', title: 'One', snippet: 's1', publishedAt: '2026-01-01T00:00:00Z' },
        { url: 'https://two.example/' },
      ],
      truncated: false,
    })

    const fetched = await registered.fetchProviders[0]?.fetch({ url: 'https://x.example/page' } as never, undefined)
    expect(coreState.fetchCalls[0]?.req).toEqual({ url: 'https://x.example/page' })
    expect(fetched).toEqual({ url: 'https://x.example/page', statusCode: 200, body: { kind: 'text', content: 'body' }, truncated: false })
  })

  it('maps core provider errors to WebError', async () => {
    coreState.searchImpl = async () => {
      const { CoreError } = await import('@agents-web-search/core')
      throw new CoreError('timed out', 'WEB_SEARCH_TIMEOUT')
    }
    const { ctx, registered } = makeCtx()
    apply(ctx as never, {})
    const { WebError } = await import('@deepseek-ai/dsh-web')
    await expect(registered.searchProviders[0]?.search({ query: 'x' } as never, undefined)).rejects.toMatchObject({
      name: 'WebError',
      code: 'WEB_SEARCH_TIMEOUT',
      message: 'timed out',
    })
    expect(() => toHostError(new WebError('m', 'WEB_TIMEOUT'))).not.toThrow()
  })

  it('throws a friendly error on a duplicate search provider', async () => {
    const { WebError } = await import('@deepseek-ai/dsh-web')
    const { ctx } = makeCtx({ duplicateError: new WebError('duplicate', 'WEB_DUPLICATE_PROVIDER') })
    expect(() => apply(ctx as never, {})).toThrowError(WebError)
    expect(() => apply(ctx as never, {})).toThrow(/mutually exclusive/)
  })

  it('registers only the adapter tools (never web_search/web_fetch) with converted schemas', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx as never, {})
    const names = registered.tools.map(t => t.name)
    expect(names).toEqual(['get_search_content', 'web_platform_search', 'web_history', 'web_search_stats', 'web_cache_clear'])

    const history = registered.tools.find(t => t.name === 'web_history') as { parameters: Record<string, unknown>; isConcurrencySafe: () => boolean }
    expect(history.parameters).toEqual({
      kind: { type: 'string', enum: ['search', 'fetch', 'all'] },
      limit: { type: 'integer' },
    })
    expect(history.isConcurrencySafe()).toBe(true)
    const platform = registered.tools.find(t => t.name === 'web_platform_search') as { isConcurrencySafe: () => boolean }
    expect(platform.isConcurrencySafe()).toBe(true)
  })

  it('registers the prompt section, settings section, and the lifecycle effect', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx as never, {})
    expect(registered.sections).toHaveLength(1)
    expect(registered.sections[0]?.name).toBe('tool:agents_web_search')
    expect(registered.installSection.calls).toHaveLength(1)
    expect(registered.installSection.calls[0]?.[1]).toBe('agents-web-search')
    expect(registered.effects).toHaveLength(1)
    expect(registered.effects[0]?.label).toBe('agents-web-search.dispose()')

    // The effect disposer unregisters tools and disposes the stack.
    registered.effects[0]?.disposer?.()
    expect(coreState.disposeCalls).toBe(1)
  })

  it('rejects an invalid search.mode before any registration', () => {
    const { ctx, registered } = makeCtx()
    expect(() => apply(ctx as never, { search: { mode: 'bogus' as never } })).toThrow(/fallback.*fuse/)
    expect(registered.searchProviders).toHaveLength(0)
  })
})
