// Live check (opt-in, never in CI): stops the real local SearXNG service and
// verifies the real autostart brings it back (systemd on Linux, launchd on
// macOS).
//   LIVE_AUTOSTART=1 npx vitest run test/searxng-autostart.live.test.ts
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { SEARXNG_DEFAULT_ENDPOINT } from '@agents-web-search/core'
import { SEARXNG_LAUNCHD_LABEL, SEARXNG_UNIT_NAME, searxngAlive, startLocalSearxng } from '../src/searxng-health.ts'

const LIVE = process.env.LIVE_AUTOSTART === '1'
const DARWIN = process.platform === 'darwin'

function stopService(): void {
  if (DARWIN) {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid?.()}/${SEARXNG_LAUNCHD_LABEL}`])
  } else {
    execFileSync('systemctl', ['--user', 'stop', SEARXNG_UNIT_NAME])
  }
}

function serviceState(): string {
  if (DARWIN) {
    try {
      const out = execFileSync('launchctl', ['print', `gui/${process.getuid?.()}/${SEARXNG_LAUNCHD_LABEL}`], { encoding: 'utf8' })
      return /state = running/.test(out) ? 'active' : 'inactive'
    } catch {
      return 'inactive' // not loaded
    }
  }
  return execFileSync('systemctl', ['--user', 'is-active', SEARXNG_UNIT_NAME], { encoding: 'utf8' }).trim()
}

describe.skipIf(!LIVE)('live service autostart (real machine)', () => {
  it('stopped service is brought back up', async () => {
    stopService()
    expect(await searxngAlive(SEARXNG_DEFAULT_ENDPOINT)).toBe(false)
    expect(await startLocalSearxng(SEARXNG_DEFAULT_ENDPOINT, 45_000)).toBe('up')
    expect(serviceState()).toBe('active')
  }, 60_000)
})
