import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDshLlmClient } from '../src/llm.ts'

describe('createDshLlmClient (5.4, DEEPSEEK_API_KEY env)', () => {
  const savedKey = process.env['DEEPSEEK_API_KEY']
  const savedBase = process.env['DEEPSEEK_BASE_URL']

  beforeEach(() => {
    delete process.env['DEEPSEEK_API_KEY']
    delete process.env['DEEPSEEK_BASE_URL']
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env['DEEPSEEK_API_KEY']
    else process.env['DEEPSEEK_API_KEY'] = savedKey
    if (savedBase === undefined) delete process.env['DEEPSEEK_BASE_URL']
    else process.env['DEEPSEEK_BASE_URL'] = savedBase
    vi.unstubAllGlobals()
  })

  it('is undefined (fail-closed) without a key', () => {
    expect(createDshLlmClient()).toBeUndefined()
  })

  it('completes through the DeepSeek chat-completions endpoint', async () => {
    process.env['DEEPSEEK_API_KEY'] = 'sk-test'
    process.env['DEEPSEEK_BASE_URL'] = 'https://llm.example/'
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe('https://llm.example/chat/completions')
      const headers = init.headers as Record<string, string>
      expect(headers['authorization']).toBe('Bearer sk-test')
      const body = JSON.parse(init.body as string) as { model: string; messages: unknown[] }
      expect(body.model).toBe('deepseek-chat')
      expect(body.messages).toEqual([{ role: 'user', content: 'say hi' }])
      return new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: 'hello from deepseek' } }],
          usage: { prompt_tokens: 4, completion_tokens: 6 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createDshLlmClient()
    expect(client).toBeDefined()
    const result = await client!.complete({ prompt: 'say hi', maxTokens: 64 })
    expect(result.text).toBe('hello from deepseek')
    expect(result.model).toBe('deepseek-chat')
    expect(result.usage).toEqual({ in: 4, out: 6 })
  })

  it('throws on a non-2xx API response', async () => {
    process.env['DEEPSEEK_API_KEY'] = 'sk-test'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    const client = createDshLlmClient()
    await expect(client!.complete({ prompt: 'x' })).rejects.toThrow(/HTTP 429/)
  })

  it('throws when the API returns an empty completion', async () => {
    process.env['DEEPSEEK_API_KEY'] = 'sk-test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const client = createDshLlmClient()
    await expect(client!.complete({ prompt: 'x' })).rejects.toThrow(/empty completion/)
  })
})
