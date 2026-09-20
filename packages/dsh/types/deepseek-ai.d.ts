/**
 * Type stubs for the `@deepseek-ai/*` peer dependencies of the DSH adapter.
 * They are resolved from the host DSH deployment at runtime and are NOT
 * installed in this package's `node_modules` (peer deps). This stub file lets
 * `tsc` typecheck the adapter in isolation (CI, editor) without the host.
 *
 * The stubs mirror the public API surface the adapter imports, with the real
 * signatures (checked against the DSH checkout — see `typecheck:host`). Only
 * the members the adapter actually uses are declared. `typecheck:host`
 * replaces these stubs with the host's real types for a stricter check.
 */

declare module '@deepseek-ai/cordis' {
  import type { WebSearchProvider, WebFetchProvider } from '@deepseek-ai/dsh-web'
  import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

  export interface Logger {
    info(message: string, ...meta: unknown[]): void
    warn(message: string, ...meta: unknown[]): void
    error(message: string, ...meta: unknown[]): void
    debug(message: string, ...meta: unknown[]): void
  }

  /** The `web` seam: provider registration (seam selection happens in the host). */
  export interface WebSeam {
    registerSearchProvider(provider: WebSearchProvider): () => void
    registerFetchProvider(provider: WebFetchProvider): () => void
  }

  /** The `tools` service: tool registration. */
  export interface ToolsService {
    register(definition: ToolDefinition): () => void
  }

  /** The `systemPrompt` service: ordered prompt sections. */
  export interface SystemPromptService {
    section(section: { name: string; order?: number; text: string }): void
  }

  /**
   * An effect body: a disposer, or a (possibly async) generator — or a
   * function returning one — yielding disposers.
   */
  export type EffectBody =
    | (() => void)
    | (() => Promise<void>)
    | Generator<() => void | Promise<void>, void, unknown>
    | AsyncGenerator<() => void | Promise<void>, void, unknown>
    | (() => Generator<() => void | Promise<void>, void, unknown>)
    | (() => AsyncGenerator<() => Promise<void> | void, void, unknown>)

  export interface Context {
    web: WebSeam
    tools: ToolsService
    systemPrompt: SystemPromptService
    logger: Logger
    /** Look up a service by name in the current context. */
    get<T = any>(key: string): T | undefined
    /** Inject named dependencies and run the callback with the extended context. */
    inject(keys: string[], fn: (ctx: Context) => void): void
    /**
     * Register a lifecycle effect on the current fiber; the disposer(s) run
     * when the fiber is disposed (HMR / context teardown).
     */
    effect(body: EffectBody, label?: string): () => void
    [key: string]: any
  }
}

declare module '@deepseek-ai/dsh-credentials' {
  export type CredentialRef = string & { readonly __brand: 'CredentialRef' }
  export function credentialRef(ref: string): CredentialRef
  export interface ResolvedCredential {
    value: string
    source: string
  }
  export interface CredentialsService {
    resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
  }
}

declare module '@deepseek-ai/dsh-home-paths' {
  export function dshHomePath(...parts: string[]): string
}

declare module '@deepseek-ai/dsh-launch-environment' {
  export interface LaunchEnvironmentEntry {
    value: string
    source: string
    path?: string
  }
  export interface LaunchEnvironmentSnapshot {
    get(name: string): LaunchEnvironmentEntry | undefined
  }
  export function launchEnvironmentOf(ctx: any): LaunchEnvironmentSnapshot
}

declare module '@deepseek-ai/dsh-settings' {
  export interface SettingsSectionHooks<T = any> {
    setSource(current: () => T): void
    onChange(): void
    validate?: (value: T) => void
  }
  export interface SettingsProvider {
    installSection(owner: any, ns: string, schema: any, entry: any, hooks: SettingsSectionHooks): void
  }
  // The real module augments the cordis Context with the settings service.
  declare module '@deepseek-ai/cordis' {
    interface Context {
      settings: import('@deepseek-ai/dsh-settings').SettingsProvider
    }
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
  /**
   * The execution context handed to a tool's `execute` (host `ToolRunContext`;
   * the members the adapter uses).
   */
  export interface ToolRunContext {
    readonly callId: string
    readonly name: string
    readonly agent?: unknown
    /** Caller-owned cancellation for this invocation. */
    readonly signal: AbortSignal
    [key: string]: any
  }
  /** One parameter's value schema (JSON-Schema subset, object root implicit). */
  export type ParameterSchemaSpec = { [key: string]: any }
  export type ValueSchemaSpec = any
  export type ParameterPropertySpec = any
  export interface ToolDefinition {
    name: string
    description: string
    parameters: any
    output?: { schema: any; render: (args: any, value: any) => any }
    isConcurrencySafe?: (args: any) => boolean
    execute: (args: any, exec: ToolRunContext) => Promise<any> | any
    [key: string]: any
  }
  export function defineTool(def: ToolDefinition): ToolDefinition
}

declare module '@deepseek-ai/dsh-web' {
  /** The web seam's error type (stable machine-routable `code`). */
  export class WebError extends Error {
    constructor(message: string, code: string, options?: { cause?: unknown })
    readonly code: string
  }
  export interface WebSearchSource {
    url: string
    title?: string
    snippet?: string
    publishedAt?: string
  }
  export interface WebSearchRequest {
    query: string
    maxResults?: number
  }
  export interface WebSearchResult {
    sources: readonly WebSearchSource[]
    content?: string
    truncated: boolean
  }
  export interface WebSearchProvider {
    readonly id: string
    available(): boolean
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
  }
  export interface WebFetchRequest {
    readonly url: string
  }
  export type WebFetchBody =
    | { readonly kind: 'html'; readonly content: string }
    | { readonly kind: 'text'; readonly content: string }
  export interface WebFetchResult {
    readonly url: string
    readonly statusCode: number
    readonly body: WebFetchBody
    readonly truncated: boolean
  }
  export interface WebFetchProvider {
    readonly id: string
    available(): boolean
    fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
  }
}

declare module '@deepseek-ai/schemastery' {
  /** The schemastery schema builder (zod-like). Typed `any` at stub level:
   *  the host typecheck validates real usage against the host package. */
  export const z: any
  export type z<T = any> = any
  export default z
}
