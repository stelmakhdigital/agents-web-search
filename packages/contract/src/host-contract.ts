/**
 * Host-contract test suite (ADR-002, roadmap 4.6).
 *
 * The core is agent-agnostic BECAUSE every host plugs in through the same
 * `HostAdapter` interface; this suite pins that contract down with
 * host-agnostic assertions and is run against each adapter (DSH, Pi, and
 * future agents) so a regression in any HostAdapter implementation is
 * caught by the SAME expectations.
 *
 * What the contract covers (per adapter):
 * - identity/paths shape (name/version strings, absolute stateDir);
 * - config mapping: the logical config must reach the core resolved
 *   (store path, browser flag, a valid search mode);
 * - `credential`: unknown engine → `undefined`, never throws;
 * - `toHostError`: a core `CoreError` must keep its machine-routable code
 *   host-visible; non-Error → an `Error` carrying the string;
 * - `registerTools`: returns a disposer; the disposer is idempotent;
 * - core tool execution: `web_history` on a fresh store succeeds;
 * - core error mapping: a deterministic core failure (an unknown platform
 *   for `web_platform_search`) surfaces to the host WITH its code
 *   (`WEB_PROVIDER_ERROR`);
 * - `approve` fail-closed: with no user-confirmation channel the action
 *   must NEVER resolve `true` (deny or a host-visible error);
 * - `dispose`: idempotent.
 *
 * What is intentionally NOT in the suite: host-specific surfaces (the DSH
 * `defineTool` registry vs `pi.registerTool`, the allow/deny paths that
 * need a host UI mock) — those are covered by each adapter's own tests.
 *
 * Usage (in an adapter's test file):
 * ```ts
 * import { runHostContractTests } from '@agents-web-search/contract'
 * runHostContractTests('DSH', { label: 'DSH', build: (config) => buildDshHarness(config) })
 * ```
 *
 * @module @agents-web-search/contract/host-contract
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { CoreError, type HostAdapter, type WebStack } from '@agents-web-search/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/** Logical config the suite maps onto each host's config format. */
export interface ContractConfig {
  /** SQLite store path (the suite creates a temp dir and passes the path in). */
  storePath: string
  /** Whether the browser module is enabled (ADR-005: opt-in). */
  browserEnabled: boolean
  /** Browser approval policy (default: 'navigate'). */
  approval?: 'never' | 'navigate' | 'all'
}

/** A normalized host-visible tool result (success text or machine error). */
export interface ContractToolResult {
  /** false when the host surfaced an error for this call. */
  ok: boolean
  /** The model/host-facing text (error text for failures). */
  text: string
  /** The machine error code the host made visible (failures only). */
  code?: string
}

/** The handles one test gets from `harness.build`. */
export interface ContractHandles {
  /** The adapter's HostAdapter implementation. */
  host: HostAdapter
  /** The core stack built from it. */
  stack: WebStack
  /**
   * Execute one registered adapter tool and normalize the host-visible
   * outcome (DSH: the `defineTool` execute result/throw; Pi: the
   * `pi.registerTool` execute result/throw).
   */
  callTool(name: string, args: Record<string, unknown>): Promise<ContractToolResult>
  /**
   * Invoke `host.approve` (with whatever bridge context the harness has
   * configured). Must resolve `false` or REJECT — never `true` — when the
   * host has no user-confirmation channel (fail-closed, ADR-005 §3).
   */
  approve(kind: string, description: string): Promise<boolean>
  /** Dispose the adapter (tools + stack). Must be idempotent. */
  dispose(): Promise<void>
}

/** An adapter under test: a label plus a factory for the handles. */
export interface ContractHarness {
  label: string
  build(config: ContractConfig): Promise<ContractHandles> | ContractHandles
}

/**
 * Run the host contract suite for one adapter.
 * @param harness - the adapter's harness (label + build factory).
 */
export function runHostContractTests(harness: ContractHarness): void {
  describe(`HostAdapter contract: ${harness.label}`, () => {
    let tmp: string
    let handles: ContractHandles | undefined

    async function build(overrides: Partial<Omit<ContractConfig, 'storePath'>> = {}): Promise<ContractHandles> {
      const config: ContractConfig = {
        storePath: join(tmp, 'web.db'),
        browserEnabled: false,
        approval: 'navigate',
        ...overrides,
      }
      return await harness.build(config)
    }

    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'aws-contract-'))
    })
    afterEach(async () => {
      if (handles !== undefined) await handles.dispose()
      handles = undefined
      await rm(tmp, { recursive: true, force: true })
    })

    it('identity: name and version are non-empty strings', async () => {
      handles = await build()
      expect(typeof handles.host.identity.name).toBe('string')
      expect(handles.host.identity.name.length).toBeGreaterThan(0)
      // Adapters MUST provide a version (UA/logs/stats); the core type
      // allows undefined, the contract does not.
      expect(String(handles.host.identity.version).length).toBeGreaterThan(0)
    })

    it('paths: stateDir is an absolute path (tempDir too, when present)', async () => {
      handles = await build()
      expect(isAbsolute(handles.host.paths.stateDir)).toBe(true)
      if (handles.host.paths.tempDir !== undefined) {
        expect(isAbsolute(handles.host.paths.tempDir)).toBe(true)
      }
    })

    it('config mapping: the logical store path reaches the core resolved config', async () => {
      handles = await build()
      expect(handles.stack.config.store?.path).toBe(join(tmp, 'web.db'))
      // the core resolved a valid search mode
      expect(['fallback', 'fuse']).toContain(handles.stack.config.search.mode)
    })

    it('config mapping: browser.enabled propagates (opt-in, ADR-005)', async () => {
      const off = await build({ browserEnabled: false })
      expect(off.stack.config.browser?.enabled ?? false).toBe(false)
      const on = await build({ browserEnabled: true, approval: 'all' })
      expect(on.stack.config.browser?.enabled).toBe(true)
      expect(on.stack.config.browser?.approval).toBe('all')
      await on.dispose()
    })

    it('credential: unknown engine resolves undefined (never throws)', async () => {
      handles = await build()
      await expect(handles.host.credential('websearch:does-not-exist')).resolves.toBeUndefined()
    })

    it('toHostError: a CoreError keeps its machine code host-visible', async () => {
      handles = await build()
      const mapped = handles.host.toHostError(new CoreError('boom', 'WEB_SEARCH_TIMEOUT')) as Error
      expect(mapped).toBeInstanceOf(Error)
      // The code must be host-visible through the host's own error channel:
      // in the message (Pi: `Error (CODE): msg`) or a routable `.code`
      // property (DSH: WebError.code).
      const visible = `${String(mapped.message)} ${
        'code' in mapped ? String((mapped as { code?: unknown }).code) : ''
      }`
      expect(visible).toContain('WEB_SEARCH_TIMEOUT')
    })

    it('toHostError: a non-Error becomes an Error carrying the string', async () => {
      handles = await build()
      const mapped = handles.host.toHostError('a plain string failure')
      expect(mapped).toBeInstanceOf(Error)
      expect(String((mapped as Error).message)).toContain('a plain string failure')
    })

    it('registerTools: returns a disposer that is idempotent', async () => {
      handles = await build()
      const dispose = handles.host.registerTools(handles.stack.tools())
      expect(typeof dispose).toBe('function')
      expect(() => {
        dispose()
        dispose()
      }).not.toThrow()
    })

    it('core tool: web_history succeeds on a fresh store (empty history)', async () => {
      handles = await build()
      const result = await handles.callTool('web_history', { kind: 'all' })
      expect(result.ok).toBe(true)
      expect(result.text).toMatch(/No matching history entries/)
    })

    it('core error mapping: an unknown platform is surfaced with WEB_PROVIDER_ERROR', async () => {
      handles = await build()
      const result = await handles.callTool('web_platform_search', {
        platform: 'contract-unknown-platform',
        query: 'contract probe',
      })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('WEB_PROVIDER_ERROR')
      expect(result.text).toContain('unknown platform')
    })

    it('approve: fail-closed without a user-confirmation channel (never true)', async () => {
      handles = await build({ browserEnabled: true })
      let ok: boolean | undefined
      let error: unknown
      try {
        ok = await handles.approve('browser_navigate', 'contract probe: https://example.com/')
      } catch (caught) {
        error = caught
      }
      // The safety property: the action must be DENIED — a `false` or a
      // host-visible error. Never `true`, never an unhandled resolution.
      expect(ok ?? false).toBe(false)
      if (error !== undefined) {
        expect(error).toBeInstanceOf(Error)
        expect(String((error as Error).message).length).toBeGreaterThan(0)
      }
    })

    it('dispose: idempotent (adapter + core stack close cleanly)', async () => {
      handles = await build()
      await handles.dispose()
      await handles.dispose()
      await handles.stack.dispose()
    })
  })
}
