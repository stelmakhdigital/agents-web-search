/**
 * Shared vi.mock factories for the `@deepseek-ai/*` host modules (used by the
 * adapter tests). Each test file wires these factories via top-level
 * `vi.mock` calls (vitest hoists only top-level vi.mock).
 * @module @agents-web-search/dsh/test/host-mocks
 */

import { join } from 'node:path'

/** Minimal schemastery fake: every builder returns a chainable no-op. */
export const schemastery = () => {
  function chainable(): any {
    const f: any = () => chainable()
    f.optional = () => chainable()
    f.default = () => chainable()
    f.enum = () => chainable()
    return f
  }
  const z: any = new Proxy({}, { get: () => () => chainable() })
  return { z, default: z }
}

/** credentialRef: identity (the brand is irrelevant to the tests). */
export const credentials = () => ({
  credentialRef: (ref: string) => ref,
})

/** dshHomePath rooted at a mutable holder dir (lazily resolved at call time,
 *  so vi.mock factories can capture the holder without a TDZ on the value). */
export function homePathsHolder(holder: { baseDir: string }) {
  return {
    dshHomePath: (...parts: string[]) => join(holder.baseDir, ...parts),
  }
}

/** launchEnvironmentOf: reads `ctx.__launchEnv` (set by the fake ctx). */
export const launchEnvironment = () => ({
  launchEnvironmentOf: (ctx: { __launchEnv?: { get(name: string): { value: string } | undefined } }) =>
    ctx.__launchEnv ?? { get: () => undefined },
})

/** defineTool: identity (the fake ctx.tools.register captures the definition). */
export const tools = () => ({
  defineTool: (def: unknown) => def,
})

/** WebError with real semantics (code + cause). */
export const web = () => {
  class WebError extends Error {
    readonly code: string
    constructor(message: string, code: string, options?: { cause?: unknown }) {
      super(message, options)
      this.code = code
      this.name = 'WebError'
    }
  }
  return { WebError }
}

export interface Registered {
  searchProviders: Array<{ id: string; available(): boolean; search(req: never, signal?: AbortSignal): Promise<unknown> }>
  fetchProviders: Array<{ id: string; available(): boolean; fetch(req: never, signal?: AbortSignal): Promise<unknown> }>
  tools: Array<Record<string, unknown>>
  sections: Array<{ name: string; order?: number; text: string }>
  effects: Array<{ label?: string; disposer?: () => void | Promise<void> }>
  installSection: { calls: Array<unknown[]> }
}

export interface FakeCtxOptions {
  credentials?: unknown
  approval?: unknown
  launchEnv?: { get(name: string): { value: string } | undefined }
  /** Error thrown when registering the `multi` search provider. */
  duplicateError?: unknown
}

/** A fake cordis Context recording every registration. */
export function makeCtx(options: FakeCtxOptions = {}): { ctx: Record<string, unknown>; registered: Registered } {
  const registered: Registered = {
    searchProviders: [],
    fetchProviders: [],
    tools: [],
    sections: [],
    effects: [],
    installSection: { calls: [] },
  }
  const installSection = (...args: unknown[]): void => {
    registered.installSection.calls.push(args)
  }
  const ctx: Record<string, unknown> = {
    web: {
      registerSearchProvider: (provider: { id: string }) => {
        if (options.duplicateError !== undefined && provider.id === 'multi') {
          throw options.duplicateError
        }
        registered.searchProviders.push(provider as never)
        return () => {}
      },
      registerFetchProvider: (provider: { id: string }) => {
        registered.fetchProviders.push(provider as never)
        return () => {}
      },
    },
    tools: {
      register: (definition: Record<string, unknown>) => {
        registered.tools.push(definition)
        return () => {}
      },
    },
    systemPrompt: {
      section: (section: { name: string; order?: number; text: string }) => {
        registered.sections.push(section)
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    get: (key: string) => {
      if (key === 'credentials') return options.credentials
      if (key === 'approval') return options.approval
      return undefined
    },
    inject: (_keys: string[], fn: (extended: Record<string, unknown>) => void) => {
      fn({ settings: { installSection } })
    },
    effect: (body: unknown, label?: string) => {
      let disposer: (() => void | Promise<void>) | undefined
      if (typeof body === 'function') {
        const generator = (body as () => Generator<() => void | Promise<void>, void, unknown>)()
        const first = generator.next()
        if (!first.done) disposer = first.value
      }
      registered.effects.push({ label, disposer })
      return () => {}
    },
    __launchEnv: options.launchEnv,
  }
  return { ctx, registered }
}
