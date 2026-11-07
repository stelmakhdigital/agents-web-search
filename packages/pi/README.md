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

Channel: **git** (decision 2026-09-21 — not published to npm). Pi installs
a git repo in **one command** (it clones into its install dir and runs
`npm install` itself; the repo is self-contained — the pinned core tarball
ships inside it):

```sh
pi install https://github.com/stelmakhdigital/agents-web-search.git@v1.4.7   # user scope
pi install -l https://github.com/stelmakhdigital/agents-web-search.git@v1.4.7  # project scope
pi list                                                # verify
# update: pi update (for a pinned ref — fetch origin <ref>)
```

Dev mode (from a workspace checkout): `pi install /path/to/agents-web-search/packages/pi`,
or copy the extension dir (`packages/pi/agents-web-search`) to
`~/.pi/agent/extensions/agents-web-search`
(or point `settings.json` `extensions` at it), then `/reload` in a running
session.

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
| `browser_*` (8 tools) | Playwright browser automation — ships ON (`browser.enabled: false` to opt out) | sequential |

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
    "engines": ["exa", "ddg"],        // default: searxng, ddg, bing (fallback mode; searxng is optional — see SearXNG below)
    "mode": "fuse",                   // "fallback" (default) | "fuse" (parallel + RRF)
    "enrich": { "enabled": true, "fetchLimit": 6, "keep": 5 },
    "embed": { "endpoint": "" }        // embedding re-rank (optional)
  },
  "store": { "path": "" },            // default: <agentDir>/web-search/web.db
  },
  "fetch": { "maxOutputChars": 100000, "revalidate": true, "allowPrivateNetworks": false, "pdf": { "enabled": true, "maxSizeBytes": 20971520, "maxPages": 50 } },
  "platforms": { "enabled": true },   // false hides web_platform_search
  "history": { "history": true, "cacheClear": true, "stats": true },
  "browser": {
    "enabled": true,                  // browser module ships ON (set false to opt out)
    "headless": true,
    "approval": "navigate",           // "never" | "navigate" (default) | "all"
    "allowPrivateNetworks": false     // SSRF guard: private/reserved hosts are blocked by default
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
- **The file type is the core's config**: any `CoreConfig` key is usable
  without an adapter update (`search.maxSerpBytes`, `browser.authProfiles`,
  `ssrf.trustEnvProxy`, …). Legacy pre-1.4.7 names (`search.storePath`,
  `search.embedEndpoint`/`embedModel`) are still normalized on load; the
  core-shaped fields win when both are present.
- **Debug log**: start pi with `WEB_SEARCH_DEBUG=1` to append the core's
  structured search/fetch log lines to `<agentDir>/web-search/log.txt`.
- **Diagnostics**: `web_search_stats` lists every engine with its routing
  state (unavailable / cooldown ms / consecutive failures) — the built-in
  doctor for "why is the search degraded".
- **Browser module ships ON** (`browser.enabled` defaults to true; set
  `false` to opt out). The playwright npm package installs with the plugin;
  the Chromium binary is downloaded once — `scripts/browser/install.sh`
  (uses the playwright of the installed adapter) or `npx playwright install
  chromium`. On `session_start` (once per process, never in subagents) the
  adapter probes readiness (`browserReadiness()` from the core): a missing
  browser yields one warning with the exact fix + a session-log entry
  (`web-search-browser-setup`) — no launch, no download, no blocking.
- **SSRF guard**: by default the browser (and `web_fetch` / `web_platform_search`) **blocks private/reserved addresses** — LAN (`192.168.x.x`, `10.x`, …) and loopback (`127.0.0.1`) ⇒ `Error (BROWSER_SSRF_BLOCKED)`. To reach local services (dev dashboards, local APIs) set `"allowPrivateNetworks": true` in the corresponding section (`browser` / `fetch` / `platforms`). This is a network boundary, not a permission gate — the `/browser-guard` toggle does not affect it. For the **browser** only, `/browser-guard:ssrf` flips the guard for the current session without touching the file (footer badge `🔓 SSRF OFF`); the state is persistent like the other guard toggles (`guard-state.json`, survives `/reload` and `pi -c`), and a new session falls back to the config value.

## SearXNG (local instance)

The default engine chain is `searxng, ddg, bing`: the core first tries a
**local SearXNG instance** (multi-engine metasearch, no cloud APIs, no
data brokers), then falls through to the keyless public engines. The
instance is optional — when it is not running the search simply goes to
`ddg`/`bing` (a refused connection fails immediately; a silently dropping
host is cut by a ~3 s connect guard, then the engine cools down).

One-command install (native, no docker: Python venv + systemd **user** unit,
bind `127.0.0.1:8080` = the core's `SEARXNG_DEFAULT_ENDPOINT`):

```bash
git clone https://github.com/stelmakhdigital/agents-web-search.git \
  && agents-web-search/scripts/searxng/install.sh
```

What it does: creates a venv at `~/.pi/agent/web-search/searxng/venv`,
clones the official SearXNG repo (the PyPI package `searxng` is an
unrelated MCP server — not used), installs the engine + waitress, writes a
minimal `settings.yml` (`search.formats: [html, json]`, `limiter: false`,
`valkey.url: false`, persistent secret key) and starts `searxng.service` as
a systemd user unit. Idempotent; `update` pulls the latest source (rolling
release), `status` shows the unit state + probes, `uninstall` removes
everything. Requires python ≥ 3.9, git; without a systemd user session it
prints the manual start command.

**Startup health-check**: on `session_start` (reason `startup`, once per pi
process, never in subagent processes) the adapter probes
`{endpoint}/healthz` with an 800 ms timeout, fire-and-forget — the session
start is never blocked. A dead instance produces one warning:
`agents-web-search: SearXNG недоступен на <endpoint> — поиск пойдёт через
ddg+bing …` with the install-script hint. The endpoint comes from
`providers.searxng.endpoint` or the core default. To disable the check,
remove `searxng` from `search.engines` in `web-search.json` (an unset
`search.engines` inherits the core default chain, which includes it).
The model is not left guessing: the dead instance is recorded as a session
log entry (`web-search-searxng-down`), and the first `web_search` result of
the session carries a note explaining that results came from the
`ddg`/`bing` fallback.

### Browser approval (fail-closed)

Browser actions are permission-gated through the Pi dialog
(`ctx.ui.confirm`): default policy `navigate` gates `browser_navigate` +
`browser_evaluate` (the two arbitrary-code paths); `all` additionally gates
click/type; `never` disables the gate. **Fail-closed**: when no dialog-capable
UI is available (`--mode json` / `-p`), the action is **denied** — never
executed silently.

**Session toggle** (same convention as pi-extensions bash-guard/dir-guard):
`/browser-guard` turns the confirmations OFF for the current session
(footer badge `🌐 BR OFF`), and back on again; `--browser-guard-off` starts
the session already in the no-confirm state. The state is persistent:
`~/.pi/agent/guard-state.json` (shared with pi-extensions bash-guard/
dir-guard), survives reloads and session restarts; subagent processes always
get a fresh, enabled gate.
Fine-grained relaxation: `/browser-guard:click` (pattern: `bash-guard:rm`)
lets `browser_click`/`browser_type` run without a dialog while
`browser_navigate`/`browser_evaluate` keep asking (footer badge `🖱 C/T OFF`);
only meaningful with the `all` approval policy, and fail-closed without a
dialog UI is never relaxed.
Network-level override: `/browser-guard:ssrf` toggles the browser SSRF guard
(allow/block private & reserved addresses) for the session, with the same
persistence rules (new session ⇒ config `browser.allowPrivateNetworks`)
and footer badge `🔓 SSRF OFF`.

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
