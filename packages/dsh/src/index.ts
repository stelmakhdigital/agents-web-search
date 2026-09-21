/**
 * `@agents-web-search/dsh` — DeepSeek Harness adapter for the agent-agnostic
 * web-search core (`@agents-web-search/core`).
 *
 * A cordis plugin that registers the core's web stack into the DSH host:
 * - the core's multi-engine search provider and cached fetch provider into the
 *   `web` seam (ids `multi`/`cached-http` — parity with the built-in web
 *   packages, so the local-web overlay pins them; the plugin and the built-in
 *   stack are mutually exclusive, like dsh-web-automation);
 * - the core's model-facing tools EXCEPT `web_search`/`web_fetch` (the host's
 *   `tool-web` owns those): `web_platform_search`, `web_history`,
 *   `web_search_stats`, `web_cache_clear`, and — when `browser.enabled` — the
 *   `browser_*` tools (ADR-002 §2);
 * - a settings section (`agents-web-search`) for committed config edits.
 *
 * All search/fetch/store/platform logic lives in the core; this package only
 * maps host ⇄ core (ADR-002). Everything runs against local state
 * (`$DSH_HOME/web.db`).
 * @module @agents-web-search/dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import { WebError } from '@deepseek-ai/dsh-web'
import type { FetchResult, SearchSource } from '@agents-web-search/core'

// Augments the cordis `Context` type with `settings` (the dsh-settings module
// declares `Context.settings: SettingsProvider`).
import type {} from '@deepseek-ai/dsh-settings'

import { Config as ConfigSchema, toCoreConfig, type Config as PluginConfig } from './config.ts'
import {
  FETCH_PROVIDER_ID,
  PLUGIN_NAME,
  SEARCH_PROVIDER_ID,
  SETTINGS_NAMESPACE,
  buildDshWebStack,
  toHostError,
} from './host.ts'

/** Cordis plugin name (loader diagnostics). */
export const name = PLUGIN_NAME

/** Services this plugin touches: the web seam, tools, and the system prompt. */
export const inject = ['web', 'tools', 'systemPrompt']

/** Re-export the plugin config surface (schemastery schema + types). */
export { Config, type EngineBlockConfig, type EngineKeyConfig } from './config.ts'

/** Re-export the host adapter surface (provider ids, error mapping). */
export { FETCH_PROVIDER_ID, SEARCH_PROVIDER_ID, SETTINGS_NAMESPACE, toHostError } from './host.ts'

/** A core `SearchSource` projected to the seam's `WebSearchSource`. */
function seamSource(source: SearchSource): { url: string; title?: string; snippet?: string; publishedAt?: string } {
  return {
    url: source.url,
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.snippet !== undefined ? { snippet: source.snippet } : {}),
    ...(source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {}),
  }
}

/** Project a core `FetchResult` to the seam's `WebFetchResult`. */
function seamFetch(result: FetchResult): WebFetchResult {
  return {
    url: result.url,
    statusCode: result.statusCode,
    body: { kind: result.body.kind, content: result.body.content },
    truncated: result.truncated,
  }
}

/**
 * Register the core web stack with the DSH host: the seam providers, the
 * adapter's tools (via the host adapter), the settings section, and the
 * lifecycle (tools + stack close on fiber dispose).
 * @param ctx - the Cordis plugin context.
 * @param config - the resolved plugin config (schemastery has applied defaults).
 */
export function apply(ctx: Context, config: PluginConfig): void {
  const searchMode = config.search?.mode
  if (searchMode !== undefined && searchMode !== 'fallback' && searchMode !== 'fuse') {
    throw new Error(`agents-web-search: search.mode must be "fallback" or "fuse", got "${searchMode}"`)
  }
  // Fail fast on a malformed config (before any registration).
  toCoreConfig(config)

  const { stack, disposeTools } = buildDshWebStack(ctx, config)

  const searchProvider: WebSearchProvider = {
    id: SEARCH_PROVIDER_ID,
    available: () => true, // the keyless engines (ddg/bing) always make the stack usable
    search: async (request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> => {
      try {
        const result = await stack.search(
          { query: request.query, ...(request.maxResults !== undefined ? { maxResults: request.maxResults } : {}) },
          signal,
        )
        return {
          ...(result.content !== undefined ? { content: result.content } : {}),
          sources: result.sources.map(seamSource),
          truncated: result.truncated,
        }
      } catch (error) {
        throw toHostError(error)
      }
    },
  }

  const fetchProvider: WebFetchProvider = {
    id: FETCH_PROVIDER_ID,
    available: () => true,
    fetch: async (request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> => {
      try {
        return seamFetch(await stack.fetch({ url: request.url }, signal))
      } catch (error) {
        throw toHostError(error)
      }
    },
  }

  try {
    ctx.web.registerSearchProvider(searchProvider)
  } catch (error) {
    if (error instanceof WebError && error.code === 'WEB_DUPLICATE_PROVIDER') {
      throw new WebError(
        'the "multi" search provider is already registered: the @agents-web-search/dsh plugin and DSH built-in web packages (e.g. the local-web overlay) are mutually exclusive — keep one',
        'WEB_DUPLICATE_PROVIDER',
        { cause: error },
      )
    }
    throw error
  }
  ctx.web.registerFetchProvider(fetchProvider)

  // System prompt guidance for the adapter's tools (the host's tool-web owns
  // the web_search/web_fetch prompt section).
  ctx.systemPrompt.section({
    name: 'tool:agents_web_search',
    order: 116,
    text: 'Use web_platform_search for platform-specific searches (GitHub, Reddit, YouTube, …), get_search_content to read the full cached content of a previous web_search/web_fetch result (by the record id printed in their output), web_history to review recent web searches and fetches, web_search_stats for web storage statistics, and web_cache_clear to clear the web search/page cache. These tools read the shared local web store; they make no network requests (except web_platform_search).',
  })

  // Committed config edits (settings section); v0.1 applies them at the next
  // launch (rebuilding the core stack live is a follow-up).
  let currentSource: () => PluginConfig = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, ConfigSchema, config, {
      setSource: (source) => {
        currentSource = source
      },
      onChange: () => {
        ctx.logger?.info('agents-web-search: config changed; it applies at the next launch')
      },
    })
  })
  void currentSource

  // Lifecycle: unregister the adapter's tools and close the stack (store,
  // browser) when this plugin's fiber is disposed (HMR / context teardown).
  ctx.effect(
    function* () {
      yield () => {
        disposeTools()
        void stack.dispose()
      }
    },
    'agents-web-search.dispose()',
  )
}
