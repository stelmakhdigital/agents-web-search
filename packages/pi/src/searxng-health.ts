/**
 * SearXNG local-instance health-check (startup convenience): the default
 * engine chain starts with `searxng`, so a dead local instance would cost
 * one refused request per search before the router falls through to
 * `ddg`/`bing`. The check runs once per pi process on `session_start`
 * (reason `startup`), never blocks the session start (fire-and-forget with
 * a small timeout) and only warns through the host UI.
 *
 * The instance is installed/started by `scripts/searxng/install.sh`
 * (repo root): a native (no-docker) SearXNG venv + a systemd user unit
 * listening on `127.0.0.1:8080` — the core's `SEARXNG_DEFAULT_ENDPOINT`.
 * @module @agents-web-search/pi/searxng-health
 */

import { SEARXNG_DEFAULT_ENDPOINT } from '@agents-web-search/core'

import type { PiConfig } from './config.ts'

/** Health-check HTTP timeout (ms) — small on purpose, startup must not wait. */
export const SEARXNG_HEALTH_TIMEOUT_MS = 800

/**
 * Whether the searxng engine participates in the search chain. When
 * `search.engines` is not set the adapter inherits the core default
 * (`searxng, ddg, bing` — never hardcoded here), so the check applies;
 * an explicit engine list without `searxng` disables the check.
 */
export function searxngInEngines(config: PiConfig): boolean {
  const engines = config.search?.engines
  if (engines === undefined) return true
  return engines.some((engine) => engine.toLowerCase() === 'searxng')
}

/**
 * The endpoint to check: the config override (`providers.searxng.endpoint`)
 * or the core's default (`SEARXNG_DEFAULT_ENDPOINT`, `http://localhost:8080`).
 */
export function searxngEndpoint(config: PiConfig): string {
  const configured = config.providers?.searxng?.endpoint
  const trimmed = configured !== undefined && configured !== '' ? configured : SEARXNG_DEFAULT_ENDPOINT
  return trimmed.replace(/\/+$/, '')
}

/**
 * Probe the instance's health endpoint (`GET {endpoint}/healthz` — the
 * SearXNG built-in liveness route, returns plain `OK`).
 * @returns true when the instance answered HTTP 2xx within the timeout.
 */
export async function searxngAlive(endpoint: string, timeoutMs: number = SEARXNG_HEALTH_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${endpoint}/healthz`, { signal: controller.signal })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
