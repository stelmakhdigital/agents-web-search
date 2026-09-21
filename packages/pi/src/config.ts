/**
 * Pi adapter configuration: `~/.pi/agent/web-search.json` → core `CoreConfig`.
 *
 * The config file is OPTIONAL: an absent or empty file yields the core's
 * built-in defaults (ddg+bing keyless search, cached fetch, platforms and
 * history tools on, browser off). Provider secrets can also come from the
 * process environment (the core's env fallback layer, ADR-002 §6) — the file
 * is for overrides and explicit keys only.
 *
 * @module @agents-web-search/pi/config
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CoreConfig, ProviderConfig } from '@agents-web-search/core'

/** Config file name inside the Pi agent directory (`~/.pi/agent/`). */
export const CONFIG_FILE_NAME = 'web-search.json'

/** One provider block (API + provider-native engines). */
export interface ProviderBlock {
  /** Explicit API key (literal). */
  apiKey?: string
  /** Env var name override (default per engine, e.g. `EXA_API_KEY`). */
  apiKeyEnv?: string
  /** Endpoint base override. */
  baseUrl?: string
  /** Model id override. */
  model?: string
  /** Max provider-side uses/depth per request. */
  maxUses?: number
  /** Never join the auto chain (cost guard; xai default). */
  explicitOnly?: boolean
}

/**
 * The Pi adapter config surface (the `web-search.json` shape). Mirrors the
 * core's capability blocks; every field is optional.
 */
export interface PiConfig {
  search?: {
    /** Ordered engine ids (default: ddg, bing). */
    engines?: string[]
    /** 'fallback' (default) or 'fuse' (parallel + RRF). */
    mode?: 'fallback' | 'fuse'
    /** Region/market hint (DDG `kl`, Bing `setmkt`). */
    region?: string
    /** Recency hint (e.g. 'day', 'week', 'month'). */
    freshness?: string
    rateLimitPerSec?: number
    /** Search timeout (ms). */
    timeoutMs?: number
    /** Search cache TTL (ms). */
    cacheTtlMs?: number
    /** Result enrichment (BM25/embedding refetch). */
    enrich?: {
      enabled?: boolean
      fetchLimit?: number
      keep?: number
      fetchTimeoutMs?: number
    }
    /** Embedding endpoint (enrich mode). */
    embedEndpoint?: string
    /** Embedding model (default: nomic-embed-text). */
    embedModel?: string
    /** SQLite store path override (default: `<agentDir>/web-search/web.db`). */
    storePath?: string
  }
  fetch?: {
    cacheTtlMs?: number
    /** Conditional revalidation (ETag/Last-Modified). */
    revalidate?: boolean
    /** Maximum output (chars). */
    maxOutputChars?: number
    timeoutMs?: number
    /** Allow private/reserved network targets (SSRF opt-out). */
    allowPrivateNetworks?: boolean
    /** PDF extraction (roadmap 5.1): application/pdf → markdown (local unpdf engine). */
    pdf?: {
      /** Enable PDF extraction. Default true. */
      enabled?: boolean
      /** Maximum PDF body size (bytes). Default 20 MiB. */
      maxSizeBytes?: number
      /** Maximum pages extracted (head-biased). Default 50. */
      maxPages?: number
    }
    /** YouTube video enrichment (roadmap 5.2): watch URLs → markdown document. */
    video?: {
      /** Enable video enrichment. Default true. */
      enabled?: boolean
    }
    /** GitHub enrichment (roadmap 5.3): repo/tree/blob → shallow clone; PR/issue → keyless API. */
    github?: {
      /** Enable GitHub enrichment. Default true. */
      enabled?: boolean
      /** Maximum clone size (bytes); oversized clones are deleted. Default 200 MiB. */
      maxCloneBytes?: number
      /** Maximum tree listing entries. Default 500. */
      maxTreeEntries?: number
    }
  }
  platforms?: {
    /** Register the `web_platform_search` tool. */
    enabled?: boolean
    /** Upper bound on sources per call. */
    maxResults?: number
    timeoutMs?: number
  }
  /** Tool switches: `web_history`, `web_cache_clear`, `web_search_stats`. */
  history?: {
    history?: boolean
    cacheClear?: boolean
    stats?: boolean
  }
  /** Extended fetch features (phase 5): curator UI (roadmap 5.4). */
  extended?: {
    /** Curator UI: local token-protected review server. */
    curator?: {
      /** Register the `web_curator` tool. Default false (opt-in). */
      enabled?: boolean
      /** Bind address (loopback only in v0.1). Default 127.0.0.1. */
      bind?: string
      /** Display host for the URL label. Default localhost. */
      host?: string
      /** Remote access (deferred in v0.1 — loopback only). Default false. */
      remote?: boolean
    }
  }
  /** Playwright browser module (off by default; ADR-005). */
  browser?: {
    enabled?: boolean
    headless?: boolean
    /** Approval policy: 'never' | 'navigate' (default) | 'all'. */
    approval?: 'never' | 'navigate' | 'all'
    allowPrivateNetworks?: boolean
    maxConcurrentTabs?: number
  }
  providers?: {
    openai?: ProviderBlock
    xai?: ProviderBlock
    anthropic?: ProviderBlock
    deepseek?: ProviderBlock
    gemini?: ProviderBlock
    perplexity?: ProviderBlock
    exa?: ProviderBlock
    tavily?: ProviderBlock
    brave?: ProviderBlock
    jina?: ProviderBlock
    searxng?: { endpoint?: string }
    ollama?: { endpoint?: string }
  }
}

/**
 * Read and parse the adapter config from the Pi agent directory.
 * @param agentDir - the Pi agent directory (`~/.pi/agent` or `$PI_CODING_AGENT_DIR`).
 * @returns the parsed config (an empty object when the file is absent).
 * @throws {Error} on a malformed JSON file or an invalid `search.mode`.
 */
export function loadPiConfig(agentDir: string): PiConfig {
  const file = join(agentDir, CONFIG_FILE_NAME)
  if (!existsSync(file)) return {}
  const raw = readFileSync(file, 'utf8')
  let config: PiConfig
  try {
    config = JSON.parse(raw) as PiConfig
  } catch (error) {
    throw new Error(
      `agents-web-search: cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const mode = config.search?.mode
  if (mode !== undefined && mode !== 'fallback' && mode !== 'fuse') {
    throw new Error(`agents-web-search: search.mode must be "fallback" or "fuse", got "${String(mode)}"`)
  }
  return config
}

/** Empty strings are "not set" (the config file has no schemastery-style defaults). */
function str(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined
}

/** Map one provider block to a core `ProviderConfig` (undefined when empty). */
function providerBlock(block: ProviderBlock | undefined, engine?: string): ProviderConfig | undefined {
  if (block === undefined) return undefined
  const maxUses = block.maxUses !== undefined && block.maxUses > 0 ? block.maxUses : undefined
  const out: ProviderConfig = {
    ...(str(block.apiKey) !== undefined ? { apiKey: str(block.apiKey) as string } : {}),
    ...(str(block.apiKeyEnv) !== undefined ? { apiKeyEnv: str(block.apiKeyEnv) as string } : {}),
    ...(str(block.baseUrl) !== undefined ? { baseUrl: str(block.baseUrl) as string } : {}),
    ...(str(block.model) !== undefined ? { model: str(block.model) as string } : {}),
    ...(maxUses !== undefined ? { maxUses } : {}),
    ...(block.explicitOnly !== undefined && block.explicitOnly !== (engine === 'xai')
      ? { explicitOnly: block.explicitOnly }
      : {}),
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Map the Pi config to the core's `CoreConfig` (pure, ADR-003).
 * @param config - the parsed adapter config.
 * @returns the core config (absent keys fall back to core defaults).
 */
export function toCoreConfig(config: PiConfig): CoreConfig {
  const search = config.search ?? {}
  const fetch = config.fetch ?? {}
  const platforms = config.platforms ?? {}
  const extended = config.extended ?? {}
  const browser = config.browser ?? {}
  const providers = config.providers ?? {}

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
              ...(search.enrich.fetchTimeoutMs !== undefined
                ? { fetchTimeoutMs: search.enrich.fetchTimeoutMs }
                : {}),
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
      ...(fetch.pdf !== undefined
        ? {
            pdf: {
              ...(fetch.pdf.enabled !== undefined ? { enabled: fetch.pdf.enabled } : {}),
              ...(fetch.pdf.maxSizeBytes !== undefined ? { maxSizeBytes: fetch.pdf.maxSizeBytes } : {}),
              ...(fetch.pdf.maxPages !== undefined ? { maxPages: fetch.pdf.maxPages } : {}),
            },
          }
        : {}),
      ...(fetch.video !== undefined ? { video: { enabled: fetch.video.enabled } } : {}),
      ...(fetch.github !== undefined
        ? {
            github: {
              ...(fetch.github.enabled !== undefined ? { enabled: fetch.github.enabled } : {}),
              ...(fetch.github.maxCloneBytes !== undefined ? { maxCloneBytes: fetch.github.maxCloneBytes } : {}),
              ...(fetch.github.maxTreeEntries !== undefined ? { maxTreeEntries: fetch.github.maxTreeEntries } : {}),
            },
          }
        : {}),
    },
    platforms: {
      ...(platforms.enabled !== undefined ? { enabled: platforms.enabled } : {}),
      ...(platforms.maxResults !== undefined ? { maxResults: platforms.maxResults } : {}),
      ...(platforms.timeoutMs !== undefined ? { timeoutMs: platforms.timeoutMs } : {}),
    },
    ...(extended.curator !== undefined
      ? {
          extended: {
            curator: {
              ...(extended.curator.enabled !== undefined ? { enabled: extended.curator.enabled } : {}),
              ...(extended.curator.bind !== undefined ? { bind: extended.curator.bind } : {}),
              ...(extended.curator.host !== undefined ? { host: extended.curator.host } : {}),
              ...(extended.curator.remote !== undefined ? { remote: extended.curator.remote } : {}),
            },
          },
        }
      : {}),
    ...(browser.enabled !== undefined
      ? {
          browser: {
            enabled: browser.enabled,
            ...(browser.headless !== undefined ? { headless: browser.headless } : {}),
            ...(browser.approval !== undefined ? { approval: browser.approval } : {}),
            ...(browser.allowPrivateNetworks !== undefined
              ? { allowPrivateNetworks: browser.allowPrivateNetworks }
              : {}),
            ...(browser.maxConcurrentTabs !== undefined ? { maxConcurrentTabs: browser.maxConcurrentTabs } : {}),
          },
        }
      : {}),
    store: {
      ...(str(search.storePath) !== undefined ? { path: str(search.storePath) as string } : {}),
    },
    providers: {
      ...(providerBlock(providers.openai, 'openai') !== undefined
        ? { openai: providerBlock(providers.openai, 'openai') }
        : {}),
      ...(providerBlock(providers.xai, 'xai') !== undefined ? { xai: providerBlock(providers.xai, 'xai') } : {}),
      ...(providerBlock(providers.anthropic, 'anthropic') !== undefined
        ? { anthropic: providerBlock(providers.anthropic, 'anthropic') }
        : {}),
      ...(providerBlock(providers.deepseek, 'deepseek') !== undefined
        ? { deepseek: providerBlock(providers.deepseek, 'deepseek') }
        : {}),
      ...(providerBlock(providers.gemini, 'gemini') !== undefined
        ? { gemini: providerBlock(providers.gemini, 'gemini') }
        : {}),
      ...(providerBlock(providers.perplexity, 'perplexity') !== undefined
        ? { perplexity: providerBlock(providers.perplexity, 'perplexity') }
        : {}),
      ...(providerBlock(providers.exa, 'exa') !== undefined ? { exa: providerBlock(providers.exa, 'exa') } : {}),
      ...(providerBlock(providers.tavily, 'tavily') !== undefined
        ? { tavily: providerBlock(providers.tavily, 'tavily') }
        : {}),
      ...(providerBlock(providers.brave, 'brave') !== undefined
        ? { brave: providerBlock(providers.brave, 'brave') }
        : {}),
      ...(providerBlock(providers.jina, 'jina') !== undefined ? { jina: providerBlock(providers.jina, 'jina') } : {}),
      ...(str(providers.searxng?.endpoint) !== undefined
        ? { searxng: { endpoint: str(providers.searxng?.endpoint) as string } }
        : {}),
      ...(str(providers.ollama?.endpoint) !== undefined
        ? { ollama: { endpoint: str(providers.ollama?.endpoint) as string } }
        : {}),
    },
  }
  return core
}
