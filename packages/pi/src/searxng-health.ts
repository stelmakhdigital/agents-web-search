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

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SEARXNG_DEFAULT_ENDPOINT } from '@agents-web-search/core'

import type { PiConfig } from './config.ts'

/** Health-check HTTP timeout (ms) — small on purpose, startup must not wait. */
export const SEARXNG_HEALTH_TIMEOUT_MS = 800

/** The systemd user unit installed by `scripts/searxng/install.sh`. */
export const SEARXNG_UNIT_NAME = 'searxng.service'

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

/** True when the endpoint points at this machine (loopback) — the only case
 * where starting a local unit makes sense. */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

/** Path of the systemd user unit for the local instance (XDG-aware). */
export function searxngUnitFile(): string {
  const xdg = process.env.XDG_CONFIG_HOME !== undefined && process.env.XDG_CONFIG_HOME !== ''
    ? process.env.XDG_CONFIG_HOME
    : join(homedir(), '.config')
  return join(xdg, 'systemd', 'user', SEARXNG_UNIT_NAME)
}

/**
 * Autostart a dead local instance through the systemd user unit installed
 * by `scripts/searxng/install.sh`: `systemctl --user start searxng.service`
 * (idempotent — a no-op on a running unit), then poll `/healthz` while
 * waitress boots. Silent by design: every failure path returns false and
 * the caller falls back to the plain warning. Never throws.
 * @param endpoint - the endpoint to wait on (loopback expected).
 * @param bootWaitMs - how long to poll health after a successful start.
 * @returns `'up'` when the instance answers `/healthz` after the attempt,
 * `'skipped'` when autostart does not apply here (unit never installed),
 * `'failed'` when a start was attempted and did not bring the instance up.
 */
export type SearxngStartOutcome = 'up' | 'skipped' | 'failed'

export async function startLocalSearxng(endpoint: string, bootWaitMs = 15_000): Promise<SearxngStartOutcome> {
  if (!existsSync(searxngUnitFile())) return 'skipped' // never installed / non-systemd host
  const started = await new Promise<boolean>((resolve) => {
    try {
      const child = spawn('systemctl', ['--user', 'start', SEARXNG_UNIT_NAME], { stdio: 'ignore' })
      const timer = setTimeout(() => {
        child.kill()
        resolve(false)
      }, 8_000)
      child.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })
    } catch {
      resolve(false)
    }
  })
  if (!started) return 'failed'
  const deadline = Date.now() + bootWaitMs
  for (;;) {
    if (await searxngAlive(endpoint)) return 'up'
    if (Date.now() >= deadline) return 'failed'
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
