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

  it('accepts any core config key without adapter changes (passthrough type)', async () => {
    await writeFile(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ search: { maxSerpBytes: 1024 }, browser: { screenshotInlineDefault: true, authProfiles: { 'x': '/p' } } }),
    )
    const config = loadPiConfig(dir)
    expect(config.search?.maxSerpBytes).toBe(1024)
    expect(config.browser?.screenshotInlineDefault).toBe(true)
    expect(config.browser?.authProfiles?.['x']).toBe('/p')
  })

  it('normalizes legacy fields: storePath, embedEndpoint/embedModel', async () => {
    await writeFile(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ search: { storePath: '/legacy.db', embedEndpoint: 'http://embed.test', embedModel: 'm' } }),
    )
    const config = loadPiConfig(dir)
    expect(config.store?.path).toBe('/legacy.db')
    expect(config.search?.embed?.endpoint).toBe('http://embed.test')
    expect(config.search?.embed?.model).toBe('m')
    expect((config.search as Record<string, unknown>)['storePath']).toBeUndefined()
    expect((config.search as Record<string, unknown>)['embedEndpoint']).toBeUndefined()
  })

  it('core-shaped fields win over legacy aliases', async () => {
    await writeFile(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ search: { storePath: '/legacy.db', embedEndpoint: 'http://old.test', embed: { endpoint: 'http://new.test' } }, store: { path: '/new.db' } }),
    )
    const config = loadPiConfig(dir)
    expect(config.store?.path).toBe('/new.db')
    expect(config.search?.embed?.endpoint).toBe('http://new.test')
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
  it('maps an empty config to an empty core config (core defaults apply)', () => {
    expect(toCoreConfig({})).toEqual({})
  })

  it('strips the Pi-only history block', () => {
    const core = toCoreConfig({ history: { history: false, cacheClear: true, stats: false } })
    expect(core).toEqual({})
  })

  it('passes core-shaped blocks through (single source of truth)', () => {
    const config = {
      search: {
        engines: ['exa'],
        mode: 'fuse' as const,
        region: 'us',
        freshness: 'week',
        rateLimitPerSec: 0.5,
        timeoutMs: 15_000,
        cacheTtlMs: 60_000,
        maxSerpBytes: 1024,
        enrich: { enabled: true, fetchLimit: 4, keep: 3, fetchTimeoutMs: 9_000 },
        embed: { endpoint: 'http://embed.test/v1', model: 'm', timeoutMs: 7_000 },
      },
      fetch: { cacheTtlMs: 60_000, maxOutputChars: 1_000, allowPrivateNetworks: true, pdf: { enabled: false, maxSizeBytes: 2048, maxPages: 1 }, video: { enabled: false }, github: { enabled: false, maxCloneBytes: 1024, maxTreeEntries: 2 } },
      extended: { curator: { enabled: true, bind: '127.0.0.1', host: '127.0.0.1', remote: false } },
      platforms: { enabled: false, maxResults: 5 },
      browser: { enabled: true, headless: false, approval: 'all' as const, maxConcurrentTabs: 2 },
      store: { path: '/tmp/x.db' },
      ssrf: { trustEnvProxy: false },
    }
    expect(toCoreConfig(config)).toEqual(config)
  })

  it('drops sentinel provider values (empty strings, zero maxUses, empty blocks)', () => {
    const core = toCoreConfig({
      providers: {
        exa: { apiKey: '', maxUses: 0, apiKeyEnv: 'EXA_API_KEY' } as unknown as { apiKey?: string; apiKeyEnv?: string; baseUrl?: string },
        xai: { apiKey: 'sk-x' },
        searxng: { endpoint: '' },
      },
    })
    expect(core.providers).toEqual({
      exa: { apiKeyEnv: 'EXA_API_KEY' },
      xai: { apiKey: 'sk-x' },
    })
  })

  it('drops an all-sentinel providers block entirely', () => {
    const core = toCoreConfig({ providers: { exa: { apiKey: '' } } })
    expect(core.providers).toBeUndefined()
  })
})
