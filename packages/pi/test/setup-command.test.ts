/**
 * runWebSearchSetup: pure orchestration over injected deps — every branch
 * (browser ready/missing, searxng healthy/absent-unit/down-but-installed/
 * not-in-chain) without touching scripts, systemd, or the network.
 */
import { describe, expect, it } from 'vitest'

import { runWebSearchSetup, type SetupLine } from '../src/setup-command.ts'

interface Overrides {
  readonly readiness?: () => Promise<{ playwright: boolean; chromium: boolean; hint?: string }>
  readonly searxngHealth?: (endpoint: string) => Promise<boolean>
  readonly unitInstalled?: () => boolean
  readonly startUnit?: (endpoint: string) => Promise<boolean>
  readonly config?: Record<string, unknown>
  /** Side effect after a script ran (e.g. flip health). */
  readonly afterScript?: (name: string) => void
}

function collect(overrides: Overrides = {}): Promise<{ lines: SetupLine[]; ranScripts: string[] }> {
  const ranScripts: string[] = []
  return runWebSearchSetup({
    config: (overrides.config ?? {}) as never,
    runScript: async (name: string) => {
      ranScripts.push(name)
      overrides.afterScript?.(name)
      return `ran ${name}`
    },
    readiness: overrides.readiness ?? (async () => ({ playwright: true, chromium: true })),
    searxngHealth: overrides.searxngHealth ?? (async () => true),
    unitInstalled: overrides.unitInstalled ?? (() => true),
    startUnit: overrides.startUnit ?? (async () => true),
  }).then((lines) => ({ lines, ranScripts }))
}

describe('runWebSearchSetup', () => {
  it('everything healthy: two info lines, only the browser script re-ran (idempotent)', async () => {
    const { lines, ranScripts } = await collect()
    expect(ranScripts).toEqual(['browser/install.sh'])
    expect(lines.map((l) => l.level)).toEqual(['info', 'info'])
    expect(lines[0]?.text).toContain('браузер: готов')
    expect(lines[1]?.text).toContain('здоров')
  })

  it('browser missing system libraries: warning carries the hint (root fix stays manual)', async () => {
    const { lines } = await collect({
      readiness: async () => ({ playwright: true, chromium: true, hint: 'system libraries are missing (libnss3.so) — `npx playwright install --with-deps chromium`' }),
    })
    expect(lines[0]?.level).toBe('warning')
    expect(lines[0]?.text).toContain('--with-deps')
  })

  it('searxng not in the chain: skipped with a note', async () => {
    const { lines, ranScripts } = await collect({ config: { search: { engines: ['ddg', 'bing'] } } })
    expect(ranScripts).toEqual(['browser/install.sh'])
    expect(lines[lines.length - 1]?.text).toContain('не в цепочке')
  })

  it('searxng down + never installed: installs, re-checks health', async () => {
    let healthy = false
    const { lines, ranScripts } = await collect({
      searxngHealth: async () => healthy,
      unitInstalled: () => false,
      afterScript: (name) => {
        if (name === 'searxng/install.sh') healthy = true
      },
    })
    expect(ranScripts).toEqual(['browser/install.sh', 'searxng/install.sh'])
    expect(lines.some((l) => l.text.includes('установлен и отвечает'))).toBe(true)
  })

  it('searxng down + unit present: starts the unit, never clones', async () => {
    const { lines, ranScripts } = await collect({
      searxngHealth: async () => false,
      unitInstalled: () => true,
      startUnit: async () => true,
    })
    expect(ranScripts).toEqual(['browser/install.sh'])
    expect(lines.some((l) => l.text.includes('поднят сервис-менеджером'))).toBe(true)
  })

  it('searxng down + unit present + start fails: doctor hint', async () => {
    const { lines } = await collect({
      searxngHealth: async () => false,
      unitInstalled: () => true,
      startUnit: async () => false,
    })
    expect(lines[lines.length - 1]?.level).toBe('warning')
    expect(lines[lines.length - 1]?.text).toContain('doctor')
  })

  it('browser not downloaded: the script output tail is reported', async () => {
    const { lines } = await collect({
      readiness: async () => ({ playwright: true, chromium: false, hint: 'Chromium is not downloaded — run `npx playwright install chromium`' }),
    })
    expect(lines.some((l) => l.text.includes('ran browser/install.sh'))).toBe(true)
  })
})
