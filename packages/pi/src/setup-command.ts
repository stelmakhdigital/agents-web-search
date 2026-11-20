/**
 * `/web-search-setup` — one command that installs everything the plugin can
 * install without privileges, then reports what is still missing.
 *
 * Split from `host.ts` for testability: {@link runWebSearchSetup} takes its
 * side effects as deps (script runner, readiness probe, notifier), so the
 * host only wires pi's UI to it. Scripts come from this repo's `scripts/`
 * (present in the git-channel checkout). Root-requiring steps — system
 * libraries — are never executed; the report prints the distro-specific
 * command instead.
 * @module @agents-web-search/pi/setup-command
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { browserReadiness } from '@agents-web-search/core'

import type { PiConfig } from './config.ts'
import { isLoopbackEndpoint, searxngAlive, searxngEndpoint, searxngInEngines, searxngServiceFile, startLocalSearxng } from './searxng-health.ts'

/** The absolute path of this package's `scripts/<name>` (repo layout). */
export function scriptPath(name: string): string {
  return fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url))
}

/** Run one setup script; resolves to its output tail, never rejects. */
export function runSetupScript(name: string, timeoutMs = 20 * 60_000): Promise<string> {
  return new Promise((resolve) => {
    execFile('bash', [scriptPath(name)], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const text = `${stdout}\n${stderr}`.trim().split('\n').slice(-8).join('\n')
      resolve(error === null ? text : `ОШИБКА:\n${text}`)
    })
  })
}

/** Test seam for {@link runWebSearchSetup}. */
export interface SetupDeps {
  /** Run a `scripts/<name>` script, resolving with its output tail. */
  readonly runScript?: (name: string) => Promise<string>
  /** Browser readiness probe (defaults to the core's). */
  readonly readiness?: () => Promise<{ playwright: boolean; chromium: boolean; hint?: string }>
  /** Is the local SearXNG answering /healthz? */
  readonly searxngHealth?: (endpoint: string) => Promise<boolean>
  /** Does the systemd user unit exist (installed)? */
  readonly unitInstalled?: () => boolean
  /** Start the installed unit and wait for health (systemctl --user). */
  readonly startUnit?: (endpoint: string) => Promise<boolean>
  readonly config: PiConfig
}

/** One report line emitted by {@link runWebSearchSetup}. */
export interface SetupLine {
  readonly text: string
  readonly level: 'info' | 'warning'
}

/**
 * Run the whole setup: browser binaries (always — idempotent), local SearXNG
 * (only when the engine chain uses it and the unit was never installed),
 * then a readiness summary. The caller decides how to show the lines
 * (notify/status/appendEntry).
 */
export async function runWebSearchSetup(deps: SetupDeps): Promise<SetupLine[]> {
  const lines: SetupLine[] = []
  const runScript = deps.runScript ?? runSetupScript
  const readiness = deps.readiness ?? browserReadiness
  const health = deps.searxngHealth ?? searxngAlive
  const unitInstalled = deps.unitInstalled ?? ((): boolean => existsSync(searxngServiceFile()))
  const startUnit = deps.startUnit ?? (async (endpoint: string): Promise<boolean> => (await startLocalSearxng(endpoint)) === 'up')

  // 1) Browser binaries: the script is idempotent and re-runs are cheap.
  const browserOut = await runScript('browser/install.sh')
  const browserState = await readiness()
  if (browserState.hint === undefined) {
    lines.push({ text: 'браузер: готов (playwright + Chromium)', level: 'info' })
  } else if (!browserState.playwright) {
    lines.push({ text: `браузер: playwright не найден — ${browserState.hint}`, level: 'warning' })
  } else {
    // The hint carries the distro-specific fix (system libraries are the
    // operator's call: root-required, never automated here).
    lines.push({ text: `браузер: ${browserState.hint}`, level: 'warning' })
    if (!browserState.chromium) lines.push({ text: `вывод установки: ${browserOut}`, level: 'warning' })
  }

  // 2) Local SearXNG: full install only when the chain wants it and nothing
  // was ever installed; otherwise nudge toward update/doctor, never clone.
  if (searxngInEngines(deps.config)) {
    const endpoint = searxngEndpoint(deps.config)
    if (await health(endpoint)) {
      lines.push({ text: `SearXNG: отвечает на ${endpoint} (здоров)`, level: 'info' })
    } else if (!unitInstalled()) {
      lines.push({ text: 'SearXNG: сервис не установлен — ставлю (venv + systemd unit / LaunchAgent; займёт минуты)', level: 'info' })
      const out = await runScript('searxng/install.sh')
      const healthy = await health(endpoint)
      lines.push(
        healthy
          ? { text: `SearXNG: установлен и отвечает на ${endpoint}`, level: 'info' }
          : { text: `SearXNG: установка завершена, но ${endpoint} не отвечает — \`bash ${scriptPath('searxng/install.sh')} doctor\`\n${out}`, level: 'warning' },
      )
    } else if (await startUnit(endpoint)) {
      lines.push({ text: `SearXNG: поднят сервис-менеджером и отвечает на ${endpoint}`, level: 'info' })
    } else {
      lines.push({
        text: `SearXNG: сервис установлен, но ${endpoint} не отвечает — \`bash ${scriptPath('searxng/install.sh')} doctor\``,
        level: 'warning',
      })
    }
  } else {
    lines.push({ text: 'SearXNG: не в цепочке search.engines — пропускаю', level: 'info' })
  }

  return lines
}
