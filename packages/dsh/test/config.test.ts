import { describe, expect, it, vi } from 'vitest'
import { schemastery } from './host-mocks.ts'

vi.mock('@deepseek-ai/schemastery', () => schemastery())

import { toCoreConfig, type Config } from '../src/config.ts'

describe('toCoreConfig (DSH config → CoreConfig)', () => {
  it('empty config → empty core blocks (core applies its defaults)', () => {
    expect(toCoreConfig({})).toEqual({ search: {}, fetch: {}, platforms: {}, store: {}, providers: {} })
  })

  it('maps search settings 1:1', () => {
    const mapped = toCoreConfig({
      search: {
        engines: ['ddg', 'bing', 'exa'],
        mode: 'fuse',
        region: 'us-en',
        freshness: 'week',
        rateLimitPerSec: 2,
        timeoutMs: 12345,
        cacheTtlMs: 60000,
        enrich: { enabled: true, fetchLimit: 8, keep: 3, fetchTimeoutMs: 777 },
        embedEndpoint: 'http://localhost:11434',
        embedModel: 'nomic-embed-text',
      },
    })
    expect(mapped.search).toEqual({
      engines: ['ddg', 'bing', 'exa'],
      mode: 'fuse',
      region: 'us-en',
      freshness: 'week',
      rateLimitPerSec: 2,
      timeoutMs: 12345,
      cacheTtlMs: 60000,
      enrich: { enabled: true, fetchLimit: 8, keep: 3, fetchTimeoutMs: 777 },
      embed: { endpoint: 'http://localhost:11434', model: 'nomic-embed-text' },
    })
  })

  it('maps fetch, platforms, store and browser settings', () => {
    const mapped = toCoreConfig({
      fetch: { cacheTtlMs: 1000, revalidate: false, maxOutputChars: 5000, timeoutMs: 999, allowPrivateNetworks: true, pdf: { enabled: false, maxSizeBytes: 1_048_576, maxPages: 3 }, video: { enabled: false } },
      platforms: { enabled: false, maxResults: 5 },
      search: { storePath: '/tmp/custom-web.db' },
      browser: { enabled: true, headless: false, approval: 'all', maxConcurrentTabs: 2 },
    })
    expect(mapped.fetch).toEqual({
      cacheTtlMs: 1000,
      revalidate: false,
      maxOutputChars: 5000,
      timeoutMs: 999,
      allowPrivateNetworks: true,
      pdf: { enabled: false, maxSizeBytes: 1_048_576, maxPages: 3 },
      video: { enabled: false },
    })
    expect(mapped.platforms).toEqual({ enabled: false, maxResults: 5 })
    expect(mapped.store).toEqual({ path: '/tmp/custom-web.db' })
    expect(mapped.browser).toEqual({ enabled: true, headless: false, approval: 'all', maxConcurrentTabs: 2 })
  })

  it('maps provider blocks (baseUrl rename + optional fields)', () => {
    const mapped = toCoreConfig({
      providers: {
        openai: { apiKey: 'sk-x', model: 'gpt-5.1', maxUses: 4, explicitOnly: true },
        // xai: explicitOnly true == the engine default → omitted (the core
        // re-applies the xai default); only a non-default value is passed.
        xai: { apiKeyEnv: 'MY_XAI_KEY', baseURL: 'https://x.example/v1' },
        exa: { apiKey: 'exa-1', baseURL: 'https://exa.example' },
        deepseek: { apiKeyEnv: 'DS_KEY' },
        searxng: { endpoint: 'http://localhost:8080' },
        ollama: { endpoint: 'http://localhost:11434' },
      },
    })
    expect(mapped.providers).toEqual({
      openai: { apiKey: 'sk-x', model: 'gpt-5.1', maxUses: 4, explicitOnly: true },
      xai: { apiKeyEnv: 'MY_XAI_KEY', baseUrl: 'https://x.example/v1' },
      exa: { apiKey: 'exa-1', baseUrl: 'https://exa.example' },
      deepseek: { apiKeyEnv: 'DS_KEY' },
      searxng: { endpoint: 'http://localhost:8080' },
      ollama: { endpoint: 'http://localhost:11434' },
    })
  })

  it('empty provider blocks are omitted (no undefined keys)', () => {
    const mapped = toCoreConfig({
      providers: { openai: {}, exa: {}, searxng: {} },
    })
    expect(mapped.providers).toEqual({})
  })

  it('does not mutate the input config', () => {
    const input: Config = { search: { engines: ['ddg'] } }
    toCoreConfig(input)
    expect(input.search?.engines).toEqual(['ddg'])
  })
})
