#!/usr/bin/env node
/**
 * Strict host typecheck with a stub fallback (parity with dsh-web-automation).
 *
 * When `DSH_HOST` points at a deepseek-harness checkout (with its
 * `node_modules` installed), this resolves the `@deepseek-ai/*` peer deps to
 * the host's REAL source types (via `resolve-host-types.mjs`) and typechecks
 * the adapter against them.
 *
 * When `DSH_HOST` is unset or missing, it falls back to the local stub
 * typecheck (`npm run typecheck`) and exits with that result — so the script
 * is always a usable gate, strict when a host is available.
 *
 * Usage:
 *   DSH_HOST=/path/to/deepseek-harness npm run typecheck:host
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const host = process.env.DSH_HOST

// The package-local tsc (node_modules/typescript is a devDependency); npx is
// avoided because it needs the user npm cache (unavailable in sandboxes).
const TSC = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', 'typescript', 'bin', 'tsc')

function run(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error !== undefined) {
    console.error(`typecheck:host: ${label} failed to start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`typecheck:host: ${label} failed (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

if (host === undefined || host === '' || !existsSync(host)) {
  console.warn(`typecheck:host: DSH_HOST is not set or missing (${host ?? 'undefined'}) — falling back to the stub typecheck.`)
  run(process.execPath, [TSC, '-p', 'tsconfig.json', '--noEmit'], 'stub typecheck')
  process.exit(0)
}

run(process.execPath, [fileURLToPath(new URL('./resolve-host-types.mjs', import.meta.url)), '--host', host], 'resolve-host-types')
run(process.execPath, [TSC, '-p', 'tsconfig.host.json', '--noEmit'], 'host typecheck')
console.log('typecheck:host: OK — checked against the DSH host sources.')
