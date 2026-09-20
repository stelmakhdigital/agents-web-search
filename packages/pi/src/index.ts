/**
 * `@agents-web-search/pi` — Pi (earendil-works) adapter for the agent-agnostic
 * web-search core. SKELETON (roadmap 4.4 pending): the extension entry and the
 * build/test harness are in place; the HostAdapter implementation (config from
 * `~/.pi/agent/web-search.json`, ToolSpec → `pi.registerTool` with typebox
 * schemas, the mandatory 50KB/2000-line truncate, `ctx.ui.confirm` approval)
 * lands in roadmap 4.4.
 * @module @agents-web-search/pi
 */

/** The minimal structural view of the Pi extension API the adapter uses. */
interface PiExtensionApi {
  registerTool(tool: unknown): void
  on?(event: string, handler: unknown): void
}

/**
 * Pi extension entry. Currently a no-op placeholder (registers nothing), so
 * the package is installable and loadable from day one (`pi install
 * npm:@agents-web-search/pi`); roadmap 4.4 registers the core's tools.
 * @param pi - the Pi extension API.
 */
export default function extension(pi: PiExtensionApi): void {
  void pi
  // TODO(4.4): build the core HostAdapter (config, paths, credential,
  // registerTools → pi.registerTool + typebox + truncate, approve →
  // ctx.ui.confirm, toHostError) and register stack.tools().
}
