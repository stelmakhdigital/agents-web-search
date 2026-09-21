# @agents-web-search/pi

Pi (earendil-works) adapter for the agent-agnostic web-search core
(`@agents-web-search/core`, [ADR-002](../../core-web-search/docs/adr/ADR-002-host-adapter.md)).
Distributed as a **Pi package**: a single TypeScript extension (jiti-loaded, no
compilation step) that registers the core's web stack into the Pi runtime.

**Status: v1.0.0** (released 2026-09-21, tag `v1.0.0`) — search/fetch/
platform/history + extended fetch (PDF/YouTube/GitHub/curator),
`get_search_content`, host-level 50KB/2000-line truncate, browser module
with `ctx.ui.confirm` approval (fail-closed).

## Install

Channel: **git** (decision 2026-09-21 — not published to npm). The repo
is self-contained: the pinned core tarball (`.vendor/`) ships with it, so
a fresh clone installs offline.

```sh
git clone https://github.com/stelmakhdigital/agents-web-search.git
pi install /path/to/agents-web-search/packages/pi      # user scope
pi install -l /path/to/agents-web-search/packages/pi   # project scope
pi list                                                # verify
```

Dev mode (from a workspace checkout): copy the package dir to
`~/.pi/agent/extensions/agents-web-search` (or point `settings.json`
`extensions` at it), then `/reload` in a running session.

## Tools

In Pi there are no host-owned web tools, so the adapter registers **all**
core tools (the DSH adapter leaves `web_search`/`web_fetch` to the host):

| Tool | Purpose | Concurrency |
|---|---|---|
| `web_search` | Multi-engine search (DuckDuckGo + Bing keyless by default; Exa/Tavily/Brave/… when configured) | sequential |
| `web_fetch` | Cached, SSRF-guarded page fetch as markdown; extracts PDFs locally (5.1); enriches YouTube watch URLs (5.2); GitHub repo/tree/file from a shallow clone and PR/issue from the keyless API (5.3); `question` param answers via the host LLM (needs `llm` host member) | sequential |
| `get_search_content` | Full cached content of a previous `web_search`/`web_fetch` result by record id (5.5): `findText`/`offset`/`limit` over the stored content | parallel |
| `web_platform_search` | GitHub / Reddit / YouTube / Bilibili / v2ex / RSS / … | parallel |
| `web_history` | Recent searches/fetches from the local store | parallel |
| `web_search_stats` | Cache/statistics counters | parallel |
| `web_cache_clear` | Clear search/page caches | parallel |
| `browser_*` (8 tools) | Playwright browser automation — only when `browser.enabled` | sequential |

Every tool result is truncated to the Pi host caps — **50,000 chars /
2,000 lines** (head-biased, with a truncate marker). Tool errors surface to
the LLM with `isError: true` and the core's machine-routable code in the
message (`Error (CODE): message`).

## Configuration

All config is local. Secrets stay out of the file (env or explicit keys):

```jsonc
// ~/.pi/agent/web-search.json  — OPTIONAL; absent ⇒ core defaults
{
  "search": {
    "engines": ["exa", "ddg"],        // default: ddg, bing (fallback mode)
    "mode": "fuse",                   // "fallback" (default) | "fuse" (parallel + RRF)
    "enrich": { "enabled": true, "fetchLimit": 6, "keep": 5 },
    "storePath": ""                   // default: <agentDir>/web-search/web.db
  },
  "fetch": { "maxOutputChars": 100000, "revalidate": true, "allowPrivateNetworks": false, "pdf": { "enabled": true, "maxSizeBytes": 20971520, "maxPages": 50 } },
  "platforms": { "enabled": true },   // false hides web_platform_search
  "history": { "history": true, "cacheClear": true, "stats": true },
  "browser": {
    "enabled": false,                 // ADR-005: opt-in
    "headless": true,
    "approval": "navigate"            // "never" | "navigate" (default) | "all"
  },
  "providers": {
    "exa":    { "apiKeyEnv": "EXA_API_KEY", "maxUses": 3 },
    "xai":    { "explicitOnly": true }, // never joins the auto chain (default)
    "searxng": { "endpoint": "https://searx.example" }
  }
}
```

- **Secrets**: `providers.<engine>.apiKey` (literal) →
  `providers.<engine>.apiKeyEnv` → process environment (core env fallback).
  Engine env defaults: `OPENAI_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`,
  `BRAVE_API_KEY`, `JINA_API_KEY`, …
- **State**: `<agentDir>/web-search/web.db` (SQLite) + `temp/`; the agent dir
  is `~/.pi/agent`, overridable with `$PI_CODING_AGENT_DIR` (used by tests).
- **Config applies at startup** (the extension reads it once per process).
- `browser` needs `npx playwright install chromium` once (headless shell).

### Browser approval (fail-closed)

Browser actions are permission-gated through the Pi dialog
(`ctx.ui.confirm`): default policy `navigate` gates `browser_navigate` +
`browser_evaluate` (the two arbitrary-code paths); `all` additionally gates
click/type; `never` disables the gate. **Fail-closed**: when no dialog-capable
UI is available (`--mode json` / `-p`), the action is **denied** — never
executed silently.

## v0.1 limitations

- Config changes require a Pi restart (`/reload` re-runs the factory and
  re-registers tools; the store state persists).
- The approval bridge uses a single active tool-execution context (browser
  tools execute sequentially; the gate always resolves against the current
  session UI).
- Pi has no tool-unregistration API in v0.1 — disabled tools are filtered at
  registration time; a config switch change needs a restart to take effect.
- The `llm` host member (5.4) routes through the Pi model registry of the
  latest tool-execution context (`ctx.modelRegistry.complete(ctx.model)`);
  before the first tool run (or without a session model) LLM-dependent paths
  (`web_fetch` `question`, curator summaries) fail closed with
  `WEB_NOT_AVAILABLE`.
- Curator UI (5.4): `extended.curator.enabled: true` registers the
  `web_curator` tool — a token-protected 127.0.0.1 review page for searches
  and pages (Summarize/Discard). Remote access is deferred in v0.1.

## Development

```sh
cd agents-web-search
pnpm install --store-dir .pnpm-store
cd packages/pi
./node_modules/.bin/tsc -p tsconfig.json --noEmit   # typecheck (real pi types, devDep)
./node_modules/.bin/vitest run                      # 50 tests (config/schema/truncate/host/entry + host contract)
```

Peer `@earendil-works/pi-coding-agent` is provided by the Pi runtime
(peerDependency; devDependency for typechecking). `typebox` is a runtime
dependency. The core is consumed from the workspace tarball (dev mode);
publishing (roadmap phase 7) swaps it to the npm registry.
