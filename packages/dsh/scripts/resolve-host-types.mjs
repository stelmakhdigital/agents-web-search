#!/usr/bin/env node
/**
 * Resolve the host DSH source tree for a strict `typecheck:host` run.
 *
 * The adapter's `@deepseek-ai/*` peer deps are provided by the host DSH at
 * runtime. For a strict typecheck (instead of the local `types/deepseek-ai.d.ts`
 * stubs), this script maps every `@deepseek-ai/*` package to its SOURCE entry
 * in a DSH checkout, reusing the host's own `tsconfig.base.json` `paths` map
 * (the authoritative, maintained mapping). The host typechecks from source;
 * its third-party deps resolve from the host's own `node_modules` (run
 * `pnpm install` in the host checkout first).
 *
 * Outputs (written into the package root):
 *   - tsconfig.host.json      — real host types
 *   - types/host-stubs.d.ts   — the local stubs MINUS the modules that are
 *                               now mapped to real sources
 *
 * Usage:
 *   node scripts/resolve-host-types.mjs --host /path/to/deepseek-harness
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function parseArgs(argv) {
  const args = { host: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--host') args.host = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/resolve-host-types.mjs --host <dsh-checkout>')
      process.exit(0)
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return args
}

/** Strip JSONC comments outside of string literals. */
function stripJsoncComments(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    out += ch
  }
  return out
}

/** Match a module name against a paths key that may carry one `*` wildcard. */
function pathsKeyMatches(key, name) {
  if (!key.includes('*')) return key === name
  const pattern = `^${key.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`
  return new RegExp(pattern).test(name)
}

/** Remove `declare module '<name>' { ... }` blocks covered by the paths keys. */
function filterStubs(stubText, keys) {
  // Blank out comments first: an apostrophe inside a block comment would
  // desynchronize the string tracking in the brace scan below.
  const text = stubText.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
  const marker = /declare module '([^']+)'\s*\{/g
  let result = ''
  let cursor = 0
  let match
  while ((match = marker.exec(text)) !== null) {
    const name = match[1]
    // Skip nested module declarations already removed with their parent.
    if (match.index < cursor) continue
    const covered = keys.some(key => pathsKeyMatches(key, name))
    if (!covered) continue
    let depth = 1
    let i = match.index + match[0].length
    let inString = false
    let stringChar = ''
    let escaped = false
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === stringChar) inString = false
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = true
        stringChar = ch
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    result += text.slice(cursor, match.index)
    cursor = i
  }
  result += text.slice(cursor)
  return result
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.host === undefined) {
    console.error('error: --host <dsh-checkout> is required')
    process.exit(1)
  }
  const hostDir = isAbsolute(args.host) ? args.host : resolve(ROOT, args.host)
  const basePath = join(hostDir, 'tsconfig.base.json')
  if (!existsSync(basePath)) {
    console.error(`error: ${basePath} not found — is --host a deepseek-harness checkout?`)
    process.exit(1)
  }

  const base = JSON.parse(stripJsoncComments(readFileSync(basePath, 'utf8')))
  const paths = base?.compilerOptions?.paths
  if (paths === undefined || typeof paths !== 'object' || Object.keys(paths).length === 0) {
    console.error('error: tsconfig.base.json has no compilerOptions.paths map')
    process.exit(1)
  }

  // Rebase every paths target from the host root to the package root.
  const hostRel = relative(ROOT, hostDir).split(sep).join('/')
  const rebased = {}
  for (const [key, targets] of Object.entries(paths)) {
    rebased[key] = targets.map(target => (target.startsWith('./') ? `${hostRel}${target.slice(1)}` : target))
  }
  // The core is typechecked from its sources (dev mode; the runtime tarball in
  // .vendor/ ships no .d.ts until the core gets a declaration build).
  rebased['@agents-web-search/core'] = ['../../../core-web-search/src/index.ts']

  const compilerOptions = {
    baseUrl: '.',
    paths: rebased,
    esModuleInterop: true,
    // One mixed program needs the LOOSEST common denominator so every host
    // source file compiles; relaxing never breaks the adapter sources.
    noImplicitAny: false,
    noImplicitThis: false,
    strictFunctionTypes: false,
    noUncheckedIndexedAccess: false,
    exactOptionalPropertyTypes: false,
    noImplicitOverride: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    verbatimModuleSyntax: false,
    allowImportingTsExtensions: true,
  }

  const rootTsconfig = {
    extends: './tsconfig.json',
    compilerOptions,
    include: ['src/**/*.ts', 'test/**/*.ts', 'types/host-stubs.d.ts'],
  }

  const stubText = readFileSync(join(ROOT, 'types/deepseek-ai.d.ts'), 'utf8')
  const filteredStubs = `// GENERATED by scripts/resolve-host-types.mjs — do not edit.\n// Host-mapped @deepseek-ai/* modules resolve to real DSH sources via\n// tsconfig.host.json paths; this file keeps only the remaining stubs.\n\n${filterStubs(stubText, Object.keys(paths))}\n`

  writeFileSync(join(ROOT, 'tsconfig.host.json'), `${JSON.stringify(rootTsconfig, null, 2)}\n`)
  mkdirSync(join(ROOT, 'types'), { recursive: true })
  writeFileSync(join(ROOT, 'types/host-stubs.d.ts'), filteredStubs)

  console.log(`host: ${hostDir} (relative: ${hostRel})`)
  console.log(`mapped ${Object.keys(paths).length} paths entries; wrote tsconfig.host.json, types/host-stubs.d.ts`)
  console.log('next: npx tsc -p tsconfig.host.json --noEmit')
}

main()
