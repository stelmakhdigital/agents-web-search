import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CONFIG_FILE_NAME, loadPiConfig, toCoreConfig } from '../src/config.ts'

describe('loadPiConfig', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aws-pi-config-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns an empty config when the file is absent', () => {
    expect(loadPiConfig(dir)).toEqual({})
  })

  it('parses a written config file', async () => {
    await writeFile(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ search: { engines: ['exa'], mode: 'fuse' }, browser: { enabled: true, approval: 'all' } }),
    )
    const config = loadPiConfig(dir)
    expect(config.search?.engines).toEqual(['exa'])
    expect(config.search?.mode).toBe('fuse')
    expect(config.browser?.enabled).toBe(true)
    expect(config.browser?.approval).toBe('all')
  })

  it('throws on malformed JSON', async () => {
    await writeFile(join(dir, CONFIG_FILE_NAME), '{ not json')
    expect(() => loadPiConfig(dir)).toThrow(/cannot parse/)
  })

  it('throws on an invalid search.mode', async () => {
    await writeFile(join(dir, CONFIG_FILE_NAME), JSON.stringify({ search: { mode: 'round-robin' } }))
    expect(() => loadPiConfig(dir)).toThrow(/search\.mode/)
  })
})

describe('toCoreConfig (Pi → core mapping)', () => {
  it('maps an empty config to empty capability blocks (core defaults apply)', () => {
    const core = toCoreConfig({})
    expect(core).toEqual({ search: {}, fetch: {}, platforms: {}, store: {}, providers: {} })
  })

  it('passes search/fetch/platforms/browser through', () => {
    const core = toCoreConfig({
      search: {
        engines: ['exa'],
        mode: 'fuse',
        region: 'us',
        freshness: 'week',
        rateLimitPerSec: 0.5,
        timeoutMs: 15_000,
        cacheTtlMs: 60_000,
        enrich: { enabled: true, fetchLimit: 4, keep: 3 },
        embedEndpoint: 'http://embed.test/v1',
        embedModel: 'm',
        storePath: '/tmp/x.db',
      },
      fetch: { cacheTtlMs: 60_000, maxOutputChars: 1_000, allowPrivateNetworks: true },
      platforms: { enabled: false, maxResults: 5 },
      browser: { enabled: true, headless: false, approval: 'all', maxConcurrentTabs: 2 },
    })
    expect(core.search).toMatchObject({
      engines: ['exa'],
      mode: 'fuse',
      region: 'us',
      freshness: 'week',
      rateLimitPerSec: 0.5,
      timeoutMs: 15_000,
      cacheTtlMs: 60_000,
      enrich: { enabled: true, fetchLimit: 4, keep: 3 },
      embed: { endpoint: 'http://embed.test/v1', model: 'm' },
    })
    expect(core.fetch).toEqual({ cacheTtlMs: 60_000, maxOutputChars: 1_000, allowPrivateNetworks: true })
    expect(core.platforms).toEqual({ enabled: false, maxResults: 5 })
    expect(core.browser).toEqual({ enabled: true, headless: false, approval: 'all', maxConcurrentTabs: 2 })
    expect(core.store).toEqual({ path: '/tmp/x.db' })
  })

  it('treats empty strings and zero maxUses as unset (sentinels filtered)', () => {
    const core = toCoreConfig({
      search: { region: '' },
      providers: { exa: { apiKey: '', maxUses: 0, explicitOnly: false } },
    })
    expect(core.search).toEqual({})
    expect(core.providers).toEqual({})
  })

  it('maps provider blocks and keeps xai explicitOnly default implicit', () => {
    const core = toCoreConfig({
      providers: {
        xai: { explicitOnly: true }, // = default: must NOT be emitted
        openai: { explicitOnly: true }, // ≠ default: emitted
        exa: { apiKey: 'sk-test', maxUses: 3, apiKeyEnv: 'EXA_API_KEY', baseUrl: 'https://x', model: 'm', explicitOnly: true },
        searxng: { endpoint: 'https://searx.test' },
        ollama: { endpoint: '' },
      },
    })
    expect(core.providers).toEqual({
      openai: { explicitOnly: true },
      exa: { apiKey: 'sk-test', maxUses: 3, apiKeyEnv: 'EXA_API_KEY', baseUrl: 'https://x', model: 'm', explicitOnly: true },
      searxng: { endpoint: 'https://searx.test' },
    })
  })

  it('emits a browser block only when `enabled` is present', () => {
    expect(toCoreConfig({ browser: { headless: false } })).toEqual({
      search: {},
      fetch: {},
      platforms: {},
      store: {},
      providers: {},
    })
    expect(toCoreConfig({ browser: { enabled: true, headless: false } }).browser).toMatchObject({
      enabled: true,
      headless: false,
    })
  })
})
