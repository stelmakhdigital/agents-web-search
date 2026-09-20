# @agents-web-search/pi

Pi (earendil-works) adapter for the agent-agnostic web-search core.

**Status: skeleton** (roadmap 4.4 pending) — the package structure, build, and
test harness are in place; the extension registers nothing yet. Roadmap 4.4
implements the HostAdapter: config from `~/.pi/agent/web-search.json`,
`stack.tools()` → `pi.registerTool` (typebox schemas), the mandatory
50KB/2000-line truncate, and `ctx.ui.confirm` approval.

Install (once implemented): `pi install npm:@agents-web-search/pi`.
