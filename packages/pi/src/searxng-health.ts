/**
 * SearXNG local-instance health-check (startup convenience): the default
 * engine chain starts with `searxng`, so a dead local instance would cost
 * one refused request per search before the router falls through to
 * `ddg`/`bing`. The check runs once per pi process on `session_start`
 * (reason `startup`), never blocks the session start (fire-and-forget with
 * a small timeout) and only warns through the host UI.
 *
 * The instance is installed/started by `scripts/searxng/install.sh`
 * (repo root): a native (no-docker) SearXNG venv + a service-managed
 * instance listening on `127.0.0.1:8080` — the core's
 * `SEARXNG_DEFAULT_ENDPOINT`. Service manager per platform: systemd user
 * unit on Linux, LaunchAgent (launchd) on macOS.
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

/** The LaunchAgent label installed by `scripts/searxng/install.sh` on macOS. */
export const SEARXNG_LAUNCHD_LABEL = 'com.agents-web-search.searxng'

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

/** Path of the macOS LaunchAgent plist installed by install.sh. */
export function searxngLaunchAgentFile(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SEARXNG_LAUNCHD_LABEL}.plist`)
}

/** Path of the service definition this platform's autostart expects. */
export function searxngServiceFile(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? searxngLaunchAgentFile() : searxngUnitFile()
}

/** Run a command to completion; true on exit code 0, false on error/timeout. */
function spawnOk(cmd: string, args: string[], timeoutMs = 8_000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore' })
      const timer = setTimeout(() => {
        child.kill()
        resolve(false)
      }, timeoutMs)
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
}

/**
 * Start/restart the macOS LaunchAgent: `bootstrap` registers the plist if
 * not loaded yet (its RunAtLoad starts the instance), then `kickstart -k`
 * (re)starts the job. A fresh `bootout` unloads asynchronously, so the pair
 * is retried a few times ("Bootstrap failed: 5" race). Idempotent either
 * way; the health poll in the caller decides.
 */
async function launchdStart(): Promise<boolean> {
  const uid = process.getuid?.() ?? 501
  const target = `gui/${uid}/${SEARXNG_LAUNCHD_LABEL}`
  for (let attempt = 0; attempt < 3; attempt++) {
    // bootstrap loads the job (RunAtLoad then starts it); a not-yet-drained
    // bootout or an already-loaded job makes it fail — kickstart then covers
    // the loaded-and-running case.
    const booted = await spawnOk('launchctl', ['bootstrap', `gui/${uid}`, searxngLaunchAgentFile()])
    const kicked = await spawnOk('launchctl', ['kickstart', '-k', target])
    if (booted || kicked) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

/**
 * Autostart a dead local instance through the service definition installed
 * by `scripts/searxng/install.sh`: `systemctl --user start searxng.service`
 * on Linux, `launchctl bootstrap + kickstart -k` on macOS (both idempotent),
 * then poll `/healthz` while waitress boots. Silent by design: every failure
 * path returns false and the caller falls back to the plain warning.
 * Never throws.
 * @param endpoint - the endpoint to wait on (loopback expected).
 * @param bootWaitMs - how long to poll health after a successful start.
 * @returns `'up'` when the instance answers `/healthz` after the attempt,
 * `'skipped'` when autostart does not apply here (service never installed),
 * `'failed'` when a start was attempted and did not bring the instance up.
 */
export type SearxngStartOutcome = 'up' | 'skipped' | 'failed'

export async function startLocalSearxng(
  endpoint: string,
  // Cold start = waitress boot + searx engine registration: measured ~30 s on
  // a macOS venv; 15 s (the systemd-era default) produced false 'failed'.
  bootWaitMs = 30_000,
  platform: NodeJS.Platform = process.platform,
): Promise<SearxngStartOutcome> {
  if (!existsSync(searxngServiceFile(platform))) return 'skipped' // never installed / no service manager
  const started = platform === 'darwin'
    ? await launchdStart()
    : await spawnOk('systemctl', ['--user', 'start', SEARXNG_UNIT_NAME])
  if (!started) return 'failed'
  const deadline = Date.now() + bootWaitMs
  for (;;) {
    if (await searxngAlive(endpoint)) return 'up'
    if (Date.now() >= deadline) return 'failed'
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
