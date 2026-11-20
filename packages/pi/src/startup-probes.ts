/**
 * Startup environment probes (SearXNG health, browser module readiness).
 *
 * Both are setup problems, not runtime errors: a dead local SearXNG falls
 * through to ddg+bing, a missing Chromium binary is downloaded in the
 * background when allowed. Neither may block or fail the session start —
 * everything is fire-and-forget with the operator hint as the only output.
 *
 * Split out of `host.ts` (the session_start handler).
 *
 * @module @agents-web-search/pi/startup-probes
 */

import { browserReadiness, installChromium } from '@agents-web-search/core'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import type { PiConfig } from './config.ts'
import { isLoopbackEndpoint, searxngAlive, searxngEndpoint, searxngInEngines, startLocalSearxng } from './searxng-health.ts'
import { scriptPath } from './setup-command.ts'

// Browser readiness is probed at most once per process: session_start
// 'startup' fires once per real session, and a repeat would only re-notify
// the same setup problem.
let browserProbeFired = false

export interface StartupProbesDeps {
  /** Subagent processes never probe (no UI, shared environment). */
  isSubagent: boolean
  /** Set when the local SearXNG is dead: the first `web_search` explains the fallback. */
  searxngDown: { value?: string }
}

/** Run both probes for a `startup` session_start. Never throws, never blocks. */
export function runStartupProbes(
  pi: ExtensionAPI,
  config: PiConfig,
  ctx: ExtensionContext,
  deps: StartupProbesDeps,
): void {
  if (deps.isSubagent) return

  // SearXNG health-check (only when the searxng engine participates in the
  // chain): a dead local instance is not an error — the router falls through
  // to ddg+bing. With `searxng.autostart` (default true) a down loopback
  // instance is first brought back through the service installed by
  // scripts/searxng/install.sh (systemd user unit on Linux, LaunchAgent on
  // macOS); only if that fails (or is off/not installed) does the user get the
  // one-time hint.
  if (searxngInEngines(config)) {
    const endpoint = searxngEndpoint(config)
    const autostart = config.searxng?.autostart ?? true
    void (async () => {
      if (await searxngAlive(endpoint)) return
      // Recovery attempt through the service manager (silent 'skipped' when
      // it was never installed, the endpoint is remote, or autostart is off).
      let autostartFailed = false
      if (autostart && isLoopbackEndpoint(endpoint)) {
        const outcome = await startLocalSearxng(endpoint)
        if (outcome === 'up') {
          if (ctx.hasUI && typeof ctx.ui?.notify === 'function') {
            ctx.ui.notify(
              'agents-web-search: SearXNG был недоступен — поднят автоматически (systemd/LaunchAgent).',
              'info',
            )
          }
          return
        }
        autostartFailed = outcome === 'failed'
      }
      // 1) The model must know results will come from the fallback: the
      // first web_search of the session carries an explanatory note.
      deps.searxngDown.value = endpoint
      // 2) Session log entry (persists, not sent to the LLM).
      try { pi.appendEntry('web-search-searxng-down', { endpoint }) } catch { /* best-effort */ }
      // 3) Operator hint (TUI) — with the copy-paste-ready absolute path
      // of the installer from this checkout.
      if (ctx.hasUI && typeof ctx.ui?.notify === 'function') {
        ctx.ui.notify(
          `agents-web-search: SearXNG недоступен на ${endpoint}${autostartFailed ? ' (автозапуск через сервис-менеджер не помог)' : ''} — поиск пойдёт через ddg+bing. `
            + 'Поднять локальный инстанс: `bash ' + scriptPath('searxng/install.sh') + '` '
            + '(native venv + systemd unit / LaunchAgent, без docker). Отключить проверку: убрать searxng из search.engines в web-search.json.',
          'warning',
        )
      }
    })().catch(() => {}) // never surface a probe/start failure beyond the warning path
  }

  // Browser-module readiness (only when the module is enabled, at most once
  // per process): playwright missing or the Chromium binary not downloaded is
  // a setup problem, not a runtime error — give the operator the exact fix
  // before the first browser tool fails. With browser.autoDownload (default
  // true) the no-privilege half of the fix — the Chromium binary download — is
  // performed right here in the background; the root half (system libraries)
  // is only ever printed as the distro-specific command.
  if (!(config.browser?.enabled ?? true) || browserProbeFired) return
  browserProbeFired = true
  void (async () => {
    const notify = (text: string, level: 'info' | 'warning'): void => {
      if (ctx.hasUI && typeof ctx.ui?.notify === 'function') ctx.ui.notify(`agents-web-search: ${text}`, level)
    }
    const log = (payload: Record<string, unknown>): void => {
      try { pi.appendEntry('web-search-browser-setup', payload) } catch { /* best-effort */ }
    }
    let readiness = await browserReadiness()
    if (readiness.hint === undefined) return
    if (
      readiness.playwright
      && !readiness.chromium
      && (config.browser?.autoDownload ?? true)
    ) {
      notify('Chromium не скачан — скачиваю в фоне (playwright install chromium, ~150MB в ~/.cache)…', 'info')
      const install = await installChromium()
      if (install.ok) {
        readiness = await browserReadiness()
        if (readiness.hint === undefined) {
          log({ installed: true })
          notify('Chromium установлен — браузерные инструменты готовы.', 'info')
          return
        }
      } else {
        log({ error: install.error ?? 'chromium install failed' })
        notify(
          `не удалось скачать Chromium в фоне (${(install.error ?? '').slice(0, 200)}) — `
          + 'попробуйте вручную: `bash ' + scriptPath('browser/install.sh') + '`',
          'warning',
        )
        return
      }
    }
    log({ hint: readiness.hint })
    const setupHint = readiness.hint.includes('not downloaded')
      ? `${readiness.hint} Или одной командой: bash ${scriptPath('browser/install.sh')}`
      : readiness.hint
    notify(`браузер недоступен — ${setupHint}`, 'warning')
  })().catch(() => {}) // never surface a probe/install failure beyond the warning path
}
