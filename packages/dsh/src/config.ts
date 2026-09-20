/**
 * DSH plugin config (schemastery) and its mapping to the core's `CoreConfig`.
 *
 * The plugin config is the DSH-facing surface (cordis.yml / settings section);
 * the core sees only `CoreConfig` (ADR-003). Secrets follow the core's
 * precedence (ADR-002 §6): explicit config literal → host credential
 * (credentials domain + DSH launch environment) → process env (core layer).
 * @module @agents-web-search/dsh/config
 */

import z from '@deepseek-ai/schemastery'
import type { CoreConfig, ProviderConfig } from '@agents-web-search/core'

/** Key-carrying engine block (API engines). */
export interface EngineKeyConfig {
  /** Literal API key; wins over credential and env. */
  apiKey?: string
  /** Credential/env name override (default per engine, ADR-004 §2). */
  apiKeyEnv?: string
  /** Endpoint base override. */
  baseURL?: string
}

/** Provider-native engine block (LLM providers with a web_search tool). */
export interface EngineBlockConfig extends EngineKeyConfig {
  /** Model id override. */
  model?: string
  /** Max provider-side search uses per request. */
  maxUses?: number
  /** Explicit-only engines never join the `auto` chain (cost guard). */
  explicitOnly?: boolean
}

/** The DSH plugin config (all blocks optional; defaults come from the core). */
export interface Config {
  /** Multi-engine search settings. */
  search?: {
    /** Ordered engine ids (priority order). Default `['ddg', 'bing']`. */
    engines?: string[]
    /** 'fallback' (default) = first success wins; 'fuse' = parallel + RRF. */
    mode?: 'fallback' | 'fuse'
    /** Region/market hint (DDG `kl`, Bing `setmkt`). */
    region?: string
    /** Freshness hint: day/week/month/year. */
    freshness?: string
    /** Per-engine rate limit (requests/second). */
    rateLimitPerSec?: number
    /** Overall search deadline (ms). */
    timeoutMs?: number
    /** Search result cache TTL (ms). */
    cacheTtlMs?: number
    /** Enrichment (fetch top candidates, extract, re-rank). */
    enrich?: {
      enabled?: boolean
      fetchLimit?: number
      keep?: number
      fetchTimeoutMs?: number
    }
    /** Embedding re-rank endpoint (Ollama or any /embeddings). */
    embedEndpoint?: string
    /** Embedding model. */
    embedModel?: string
    /** SQLite store path override (default: `$DSH_HOME/web.db`). */
    storePath?: string
  }
  /** Cached HTTP(S) fetch settings. */
  fetch?: {
    /** Page cache TTL (ms). */
    cacheTtlMs?: number
    /** Conditional revalidation (ETag/Last-Modified). Default true. */
    revalidate?: boolean
    /** Maximum decoded body (chars). */
    maxOutputChars?: number
    /** Fetch timeout (ms). */
    timeoutMs?: number
    /** Allow private/reserved network targets (SSRF opt-out). */
    allowPrivateNetworks?: boolean
  }
  /** `web_platform_search` tool settings. */
  platforms?: {
    /** Register/enable the platform tool. Default true. */
    enabled?: boolean
    /** Upper bound on sources per call. */
    maxResults?: number
    /** Per-call timeout (ms). */
    timeoutMs?: number
  }
  /** History/stats/cache tool switches. */
  history?: {
    /** Register `web_history`. Default true. */
    history?: boolean
    /** Register `web_cache_clear`. Default true. */
    cacheClear?: boolean
    /** Register `web_search_stats`. Default true. */
    stats?: boolean
  }
  /** Playwright browser module (off by default; ADR-005). */
  browser?: {
    /** Enable the browser module. Default false. */
    enabled?: boolean
    /** Headless (no visible window). Default true. */
    headless?: boolean
    /** Approval policy: 'never' | 'navigate' | 'all'. Default 'navigate'. */
    approval?: 'never' | 'navigate' | 'all'
    /** Allow private/reserved network targets for browser navigation. */
    allowPrivateNetworks?: boolean
    /** Concurrent browser sessions (tabs). Default 1. */
    maxConcurrentTabs?: number
  }
  /** Provider settings for API and provider-native engines (ADR-004). */
  providers?: {
    openai?: EngineBlockConfig
    xai?: EngineBlockConfig
    anthropic?: EngineBlockConfig
    deepseek?: EngineBlockConfig
    gemini?: EngineBlockConfig
    perplexity?: EngineBlockConfig
    exa?: EngineKeyConfig
    tavily?: EngineKeyConfig
    brave?: EngineKeyConfig
    jina?: EngineKeyConfig
    searxng?: { endpoint?: string }
    ollama?: { endpoint?: string }
  }
}

/**
 * The schemastery schema for {@link Config}. Every block defaults to an empty
 * object so an empty plugin config yields the core's keyless stack
 * (ddg+bing search, cached fetch, platform + history tools enabled).
 */
/** One provider block (all leaves defaulted; `''`/`0` = not set). */
function providerBlockSchema(explicitOnlyDefault: boolean) {
  return z.object({
    apiKey: z.string().default(''),
    apiKeyEnv: z.string().default(''),
    baseURL: z.string().default(''),
    model: z.string().default(''),
    /** 0 = use the core engine default (sentinel: per-engine core defaults differ). */
    maxUses: z.number().default(0),
    explicitOnly: z.boolean().default(explicitOnlyDefault),
  }).default({ apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: explicitOnlyDefault })
}

/**
 * The schemastery schema for {@link Config}. Every leaf is defaulted (the
 * dsh-web-automation "every field is defaulted" model): an empty plugin config
 * resolves to the core's keyless stack defaults (ddg+bing search, cached fetch,
 * platform + history tools enabled, browser off).
 */
export const Config: z<Config> = z.object({
  search: z
    .object({
      engines: z.array(z.string()).default(['ddg', 'bing']),
      mode: z.union(['fallback', 'fuse']).default('fallback'),
      region: z.string().default(''),
      freshness: z.string().default(''),
      rateLimitPerSec: z.number().default(1),
      timeoutMs: z.number().default(30_000),
      cacheTtlMs: z.number().default(900_000),
      enrich: z
        .object({
          enabled: z.boolean().default(true),
          fetchLimit: z.number().default(6),
          keep: z.number().default(5),
          fetchTimeoutMs: z.number().default(10_000),
        })
        .default({ enabled: true, fetchLimit: 6, keep: 5, fetchTimeoutMs: 10_000 }),
      embedEndpoint: z.string().default(''),
      embedModel: z.string().default(''),
      storePath: z.string().default(''),
    })
    .default({
      engines: ['ddg', 'bing'],
      mode: 'fallback',
      region: '',
      freshness: '',
      rateLimitPerSec: 1,
      timeoutMs: 30_000,
      cacheTtlMs: 900_000,
      enrich: { enabled: true, fetchLimit: 6, keep: 5, fetchTimeoutMs: 10_000 },
      embedEndpoint: '',
      embedModel: '',
      storePath: '',
    }),
  fetch: z
    .object({
      cacheTtlMs: z.number().default(86_400_000),
      revalidate: z.boolean().default(true),
      maxOutputChars: z.number().default(100_000),
      timeoutMs: z.number().default(30_000),
      allowPrivateNetworks: z.boolean().default(false),
    })
    .default({ cacheTtlMs: 86_400_000, revalidate: true, maxOutputChars: 100_000, timeoutMs: 30_000, allowPrivateNetworks: false }),
  platforms: z
    .object({
      enabled: z.boolean().default(true),
      maxResults: z.number().default(20),
      timeoutMs: z.number().default(30_000),
    })
    .default({ enabled: true, maxResults: 20, timeoutMs: 30_000 }),
  history: z
    .object({
      history: z.boolean().default(true),
      cacheClear: z.boolean().default(true),
      stats: z.boolean().default(true),
    })
    .default({ history: true, cacheClear: true, stats: true }),
  browser: z
    .object({
      enabled: z.boolean().default(false),
      headless: z.boolean().default(true),
      approval: z.union(['never', 'navigate', 'all']).default('navigate'),
      allowPrivateNetworks: z.boolean().default(false),
      maxConcurrentTabs: z.number().default(1),
    })
    .default({ enabled: false, headless: true, approval: 'navigate', allowPrivateNetworks: false, maxConcurrentTabs: 1 }),
  providers: z
    .object({
      openai: providerBlockSchema(false),
      xai: providerBlockSchema(true),
      anthropic: providerBlockSchema(false),
      deepseek: providerBlockSchema(false),
      gemini: providerBlockSchema(false),
      perplexity: providerBlockSchema(false),
      exa: providerBlockSchema(false),
      tavily: providerBlockSchema(false),
      brave: providerBlockSchema(false),
      jina: providerBlockSchema(false),
      searxng: z.object({ endpoint: z.string().default('') }).default({ endpoint: '' }),
      ollama: z.object({ endpoint: z.string().default('') }).default({ endpoint: '' }),
    })
    .default({
      openai: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      xai: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: true },
      anthropic: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      deepseek: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      gemini: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      perplexity: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      exa: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      tavily: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      brave: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      jina: { apiKey: '', apiKeyEnv: '', baseURL: '', model: '', maxUses: 0, explicitOnly: false },
      searxng: { endpoint: '' },
      ollama: { endpoint: '' },
    }),
})

/**
 * Map one DSH engine block to a core `ProviderConfig` (undefined when only
 * schema zero-values are present). `''` strings and `maxUses: 0` mean "not
 * set" (schemastery defaults); `explicitOnly` is passed only when it differs
 * from the engine's default (xai: true, all others: false).
 */
function providerBlock(block: EngineBlockConfig | EngineKeyConfig | undefined, engine?: string): ProviderConfig | undefined {
  if (block === undefined) return undefined
  const str = (value: string | undefined) => (value !== undefined && value !== '' ? value : undefined)
  const model = 'model' in block ? str(block.model) : undefined
  const rawMaxUses = 'maxUses' in block ? block.maxUses : undefined
  const maxUses = rawMaxUses !== undefined && rawMaxUses > 0 ? rawMaxUses : undefined
  const explicitOnly = 'explicitOnly' in block ? block.explicitOnly : undefined
  const out: ProviderConfig = {
    ...(str(block.apiKey) !== undefined ? { apiKey: str(block.apiKey) as string } : {}),
    ...(str(block.apiKeyEnv) !== undefined ? { apiKeyEnv: str(block.apiKeyEnv) as string } : {}),
    ...(str(block.baseURL) !== undefined ? { baseUrl: str(block.baseURL) as string } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(maxUses !== undefined ? { maxUses } : {}),
    ...(explicitOnly !== undefined && explicitOnly !== (engine === 'xai') ? { explicitOnly } : {}),
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Map the DSH plugin config to the core's `CoreConfig` (ADR-003). Pure
 * function: no host access, no side effects (testable in isolation).
 * @param config - the resolved plugin config (schemastery defaults applied).
 * @returns the core config.
 */
export function toCoreConfig(config: Config): CoreConfig {
  const search = config.search ?? {}
  const fetch = config.fetch ?? {}
  const platforms = config.platforms ?? {}
  const browser = config.browser ?? {}
  const providers = config.providers ?? {}

  // Schemastery resolves every string leaf to '' when unset; '' must not
  // reach the core (empty endpoint/storePath/baseUrl would fail core checks).
  const str = (value: string | undefined) => (value !== undefined && value !== '' ? value : undefined)

  const embedEndpoint = str(search.embedEndpoint)
  const core: CoreConfig = {
    search: {
      ...(search.engines !== undefined && search.engines.length > 0 ? { engines: [...search.engines] } : {}),
      ...(search.mode !== undefined ? { mode: search.mode } : {}),
      ...(str(search.region) !== undefined ? { region: str(search.region) as string } : {}),
      ...(str(search.freshness) !== undefined ? { freshness: str(search.freshness) as string } : {}),
      ...(search.rateLimitPerSec !== undefined ? { rateLimitPerSec: search.rateLimitPerSec } : {}),
      ...(search.timeoutMs !== undefined ? { timeoutMs: search.timeoutMs } : {}),
      ...(search.cacheTtlMs !== undefined ? { cacheTtlMs: search.cacheTtlMs } : {}),
      ...(search.enrich !== undefined
        ? {
            enrich: {
              ...(search.enrich.enabled !== undefined ? { enabled: search.enrich.enabled } : {}),
              ...(search.enrich.fetchLimit !== undefined ? { fetchLimit: search.enrich.fetchLimit } : {}),
              ...(search.enrich.keep !== undefined ? { keep: search.enrich.keep } : {}),
              ...(search.enrich.fetchTimeoutMs !== undefined ? { fetchTimeoutMs: search.enrich.fetchTimeoutMs } : {}),
            },
          }
        : {}),
      ...(embedEndpoint !== undefined
        ? {
            embed: {
              endpoint: embedEndpoint,
              ...(str(search.embedModel) !== undefined ? { model: str(search.embedModel) as string } : {}),
            },
          }
        : {}),
    },
    fetch: {
      ...(fetch.cacheTtlMs !== undefined ? { cacheTtlMs: fetch.cacheTtlMs } : {}),
      ...(fetch.revalidate !== undefined ? { revalidate: fetch.revalidate } : {}),
      ...(fetch.maxOutputChars !== undefined ? { maxOutputChars: fetch.maxOutputChars } : {}),
      ...(fetch.timeoutMs !== undefined ? { timeoutMs: fetch.timeoutMs } : {}),
      ...(fetch.allowPrivateNetworks !== undefined ? { allowPrivateNetworks: fetch.allowPrivateNetworks } : {}),
    },
    platforms: {
      ...(platforms.enabled !== undefined ? { enabled: platforms.enabled } : {}),
      ...(platforms.maxResults !== undefined ? { maxResults: platforms.maxResults } : {}),
      ...(platforms.timeoutMs !== undefined ? { timeoutMs: platforms.timeoutMs } : {}),
    },
    ...(browser.enabled !== undefined
      ? {
          browser: {
            enabled: browser.enabled,
            ...(browser.headless !== undefined ? { headless: browser.headless } : {}),
            ...(browser.approval !== undefined ? { approval: browser.approval } : {}),
            ...(browser.allowPrivateNetworks !== undefined ? { allowPrivateNetworks: browser.allowPrivateNetworks } : {}),
            ...(browser.maxConcurrentTabs !== undefined ? { maxConcurrentTabs: browser.maxConcurrentTabs } : {}),
          },
        }
      : {}),
    store: {
      ...(str(search.storePath) !== undefined ? { path: str(search.storePath) as string } : {}),
    },
    providers: {
      ...(providerBlock(providers.openai, 'openai') !== undefined ? { openai: providerBlock(providers.openai, 'openai') } : {}),
      ...(providerBlock(providers.xai, 'xai') !== undefined ? { xai: providerBlock(providers.xai, 'xai') } : {}),
      ...(providerBlock(providers.anthropic, 'anthropic') !== undefined ? { anthropic: providerBlock(providers.anthropic, 'anthropic') } : {}),
      ...(providerBlock(providers.deepseek, 'deepseek') !== undefined ? { deepseek: providerBlock(providers.deepseek, 'deepseek') } : {}),
      ...(providerBlock(providers.gemini, 'gemini') !== undefined ? { gemini: providerBlock(providers.gemini, 'gemini') } : {}),
      ...(providerBlock(providers.perplexity, 'perplexity') !== undefined ? { perplexity: providerBlock(providers.perplexity, 'perplexity') } : {}),
      ...(providerBlock(providers.exa, 'exa') !== undefined ? { exa: providerBlock(providers.exa, 'exa') } : {}),
      ...(providerBlock(providers.tavily, 'tavily') !== undefined ? { tavily: providerBlock(providers.tavily, 'tavily') } : {}),
      ...(providerBlock(providers.brave, 'brave') !== undefined ? { brave: providerBlock(providers.brave, 'brave') } : {}),
      ...(providerBlock(providers.jina, 'jina') !== undefined ? { jina: providerBlock(providers.jina, 'jina') } : {}),
      ...(str(providers.searxng?.endpoint) !== undefined ? { searxng: { endpoint: str(providers.searxng?.endpoint) as string } } : {}),
      ...(str(providers.ollama?.endpoint) !== undefined ? { ollama: { endpoint: str(providers.ollama?.endpoint) as string } } : {}),
    },
  }
  return core
}
