/**
 * Pi adapter configuration: `~/.pi/agent/web-search.json` → core `CoreConfig`.
 *
 * The config file is OPTIONAL: an absent file yields the core's built-in
 * defaults. The file type IS the core's `CoreConfig` (single source of
 * truth — a new core key is usable in the file without adapter changes);
 * the only Pi-specific addition is the `history` block (host-side tool
 * switches the core does not know about). Core validation (`resolveCoreConfig`)
 * runs at stack construction and throws on bad values at startup.
 *
 * Legacy field names (pre-1.4.7 files) are normalized on load:
 * `search.storePath` → `store.path`, `search.embedEndpoint`/`embedModel` →
 * `search.embed.{endpoint,model}`.
 *
 * Secrets can also come from the process environment (the core's env
 * fallback layer, ADR-002 §6) — the file is for overrides and explicit keys.
 * @module @agents-web-search/pi/config
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CoreConfig } from '@agents-web-search/core'

/** Config file name inside the Pi agent directory (`~/.pi/agent/`). */
export const CONFIG_FILE_NAME = 'web-search.json'

/** Pi-only tool switches (host-side; the core never sees this block). */
export interface PiOnlyConfig {
  /** Tool switches: `web_history`, `web_cache_clear`, `web_search_stats`. */
  history?: {
    /** Register the `web_history` tool. Default true. */
    history?: boolean
    /** Register the `web_cache_clear` tool. Default true. */
    cacheClear?: boolean
    /** Register the `web_search_stats` tool. Default true. */
    stats?: boolean
  }
}

/**
 * The Pi adapter config surface: the core's `CoreConfig` (every block is
 * optional and defaults in the core) plus the Pi-only `history` switches.
 */
export type PiConfig = CoreConfig & PiOnlyConfig

/**
 * Read and parse the adapter config from the Pi agent directory, normalizing
 * legacy field names.
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
  normalizeLegacyFields(config as Record<string, unknown>)
  return config
}

/**
 * Map legacy (pre-1.4.7) field names onto the core config shape, in place:
 * `search.storePath` → `store.path`; `search.embedEndpoint`/`search.embedModel`
 * → `search.embed.{endpoint,model}`. Core-shaped fields always win over the
 * legacy ones when both are present.
 */
function normalizeLegacyFields(raw: Record<string, unknown>): void {
  const search = raw['search'] as Record<string, unknown> | undefined
  if (search === undefined || typeof search !== 'object') return
  const store = raw['store'] as Record<string, unknown> | undefined
  if (typeof search['storePath'] === 'string' && search['storePath'] !== '' && store?.['path'] === undefined) {
    raw['store'] = { ...store, path: search['storePath'] }
  }
  if (search['embedEndpoint'] !== undefined || search['embedModel'] !== undefined) {
    const embed = { ...(search['embed'] as Record<string, unknown> | undefined) }
    if (typeof search['embedEndpoint'] === 'string' && search['embedEndpoint'] !== '' && embed['endpoint'] === undefined) {
      embed['endpoint'] = search['embedEndpoint']
    }
    if (typeof search['embedModel'] === 'string' && search['embedModel'] !== '' && embed['model'] === undefined) {
      embed['model'] = search['embedModel']
    }
    search['embed'] = embed
  }
  delete search['storePath']
  delete search['embedEndpoint']
  delete search['embedModel']
}

/**
 * Map the Pi config to the core's `CoreConfig` (pure): strip the Pi-only
 * `history` block and drop "sentinel" provider values (empty strings, zero
 * `maxUses`, empty blocks) so the core's env-fallback layer keeps working.
 */
export function toCoreConfig(config: PiConfig): CoreConfig {
  const { history: _piOnly, providers, ...rest } = config
  let filteredProviders: CoreConfig['providers'] | undefined
  if (providers !== undefined) {
    const filtered: Record<string, unknown> = {}
    for (const [name, block] of Object.entries(providers)) {
      if (block === undefined || block === null || typeof block !== 'object') continue
      const fields = Object.fromEntries(
        Object.entries(block as Record<string, unknown>).filter(([, value]) => value !== '' && value !== 0),
      )
      if (Object.keys(fields).length > 0) filtered[name] = fields
    }
    if (Object.keys(filtered).length > 0) filteredProviders = filtered as CoreConfig['providers']
  }
  return { ...rest, ...(filteredProviders !== undefined ? { providers: filteredProviders } : {}) }
}
