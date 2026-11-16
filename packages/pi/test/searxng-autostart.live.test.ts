// Live check (opt-in, never in CI): stops the real local SearXNG unit and
// verifies the real systemd autostart brings it back.
//   LIVE_AUTOSTART=1 npx vitest run test/searxng-autostart.live.test.ts
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { SEARXNG_DEFAULT_ENDPOINT } from '@agents-web-search/core'
import { searxngAlive, startLocalSearxng } from '../src/searxng-health.ts'

const LIVE = process.env.LIVE_AUTOSTART === '1'

describe.skipIf(!LIVE)('live systemd autostart (real machine)', () => {
  it('stopped unit is brought back up', async () => {
    execFileSync('systemctl', ['--user', 'stop', 'searxng.service'])
    expect(await searxngAlive(SEARXNG_DEFAULT_ENDPOINT)).toBe(false)
    expect(await startLocalSearxng(SEARXNG_DEFAULT_ENDPOINT, 20_000)).toBe('up')
    const state = execFileSync('systemctl', ['--user', 'is-active', 'searxng.service'], { encoding: 'utf8' }).trim()
    expect(state).toBe('active')
  }, 60_000)
})
