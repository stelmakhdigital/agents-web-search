# @agents-web-search/dsh

DeepSeek Harness (DSH) adapter for the agent-agnostic web-search core
(`@agents-web-search/core`). A cordis plugin that registers the core's web
stack into the DSH host:

- the core's multi-engine search provider and cached fetch provider into the
  `web` seam (ids `multi`/`cached-http` — parity with the built-in web
  packages; the plugin and the built-in stack are mutually exclusive);
- the core's model-facing tools except `web_search`/`web_fetch` (the host's
  `tool-web` owns those): `web_platform_search`, `web_history`,
  `web_search_stats`, `web_cache_clear`, and — when `browser.enabled` — the
  `browser_*` tools;
- a settings section (`agents-web-search`) for committed config edits.

All search/fetch/store/platform logic lives in the core; this package only
maps host ⇄ core (ADR-002). Everything runs against local state
(`$DSH_HOME/web.db`).

## Local overlay

`local-web.cordis.yml` pins the seam to the adapter's providers
(`searchProvider: multi`, `fetchProvider: cached-http`) and sets the default
config. Load it together with (not instead of) the built-in web packages —
the plugin and the built-in stack are mutually exclusive
(`WEB_DUPLICATE_PROVIDER`).

## PDF fetch (core 5.1)

`web_fetch` now extracts `application/pdf` responses to markdown (local
`unpdf` engine, no API key). Config (`fetch.pdf`, all optional):

```yaml
fetch:
  pdf:
    enabled: true        # default
    maxSizeBytes: 20971520   # default 20 MiB
    maxPages: 50           # default, head-biased
```

Extracted PDFs are cached as text pages (no re-extraction on fresh hits).
Note: the DSH `web_fetch` tool is host-owned (tool-web) — the core's
`question` parameter (LLM answer) is not available for it; only the
adapter-registered core tools expose it.

## Scripts

```sh
pnpm build              # esbuild → lib/index.js (ESM, host deps external)
pnpm test               # vitest (44 tests: schema/config/entry/host adapter + host contract)
pnpm typecheck          # tsc against the local type stubs (types/)
pnpm typecheck:host     # STRICT check against the real DSH sources
                        # (requires DSH_HOST=/path/to/deepseek-harness with
                        # the host node_modules installed)
```

## Known v0.1 limitations

- Settings-section config changes apply at the next launch (the core stack is
  not rebuilt live yet).
- The approval bridge (`host.approve`) tracks a single active tool exec per
  adapter instance (browser tools are `isConcurrencySafe: false`).
- The `llm` HostAdapter member is not implemented in v0.1 — the core's
  `web_fetch` `question` mode fails with `WEB_NOT_AVAILABLE` until the host
  provides it (curator/engine injection, phase 5).
