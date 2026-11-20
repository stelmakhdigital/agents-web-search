/**
 * Contract test: constants shared between scripts/searxng/install.sh (bash)
 * and src/searxng-health.ts (TypeScript). The TS auto-start code issues
 * `systemctl --user start searxng.service` / `launchctl bootstrap gui/<uid>
 * <plist>` against what install.sh creates — a silent rename on either side
 * breaks service management on real machines and no TS-only test catches it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { SEARXNG_LAUNCHD_LABEL, SEARXNG_UNIT_NAME } from '../src/searxng-health.ts'

const script = readFileSync(fileURLToPath(new URL('../../../scripts/searxng/install.sh', import.meta.url)), 'utf8')

describe('install.sh ↔ searxng-health.ts constants', () => {
  it('launchd label matches', () => {
    expect(script).toContain(`LAUNCHD_LABEL="${SEARXNG_LAUNCHD_LABEL}"`)
  })
  it('plist lives in ~/Library/LaunchAgents under that label', () => {
    expect(script).toContain(`PLIST_FILE="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"`)
  })
  it('systemd unit name matches', () => {
    expect(script).toContain(`UNIT_NAME="${SEARXNG_UNIT_NAME}"`)
  })
  it('unit file path is XDG-aware like searxngUnitFile()', () => {
    expect(script).toContain(`UNIT_FILE="\${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT_NAME"`)
  })
  it('binds the loopback endpoint the core defaults to', () => {
    expect(script).toContain('BIND_HOST="127.0.0.1"')
    expect(script).toContain('BIND_PORT="8080"')
  })
})
