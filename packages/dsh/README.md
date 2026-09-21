# @agents-web-search/dsh

DeepSeek Harness (DSH) adapter for the agent-agnostic web-search core
(`@agents-web-search/core`). A cordis plugin that registers the core's web
stack into the DSH host:

- the core's multi-engine search provider and cached fetch provider into the
  `web` seam (ids `multi`/`cached-http`);
- the core's model-facing tools except `web_search`/`web_fetch` (the host's
  `tool-web` owns those): `get_search_content`, `web_platform_search`,
  `web_history`, `web_search_stats`, `web_cache_clear`, and — when
  `browser.enabled` — the `browser_*` tools;
- a settings section (`agents-web-search`) for committed config edits.

All search/fetch/store/platform logic lives in the core; this package only
maps host ⇄ core (ADR-002). Everything runs against local state
(`$DSH_HOME/web.db`).

## Install

Channel: **git** (decision 2026-09-21 — not published to npm). The repo
is self-contained: the pinned core tarball (`.vendor/`) ships with it, so
a fresh clone installs offline.

```sh
git clone https://github.com/stelmakhdigital/agents-web-search.git
# in a DSH profile (a dir with package.json + pnpm-workspace.yaml):
dsh plugin --profile <profile> add file:/path/to/agents-web-search/packages/dsh
dsh --profile <profile> --dump-config   # verify: web seam patched (multi/cached-http)
# update: git -C … pull + dsh plugin --profile <profile> update
```

The built-in DSH web packages use different provider ids (`http`,
`deepseek`, …), so they do NOT conflict with this plugin: the local overlay
below pins the seam to `searchProvider: multi` / `fetchProvider:
cached-http`, which also resolves `WEB_PROVIDER_AMBIGUOUS`.
`WEB_DUPLICATE_PROVIDER` can only occur when the plugin is loaded twice
(double install) — `apply()` then re-throws it with an actionable message
(roadmap 6.4).

## Local overlay

`local-web.cordis.yml` pins the seam to the adapter's providers
(`searchProvider: multi`, `fetchProvider: cached-http`) and sets the default
config. The built-in web packages may coexist (different provider ids; the
pin resolves ambiguity) — `WEB_DUPLICATE_PROVIDER` is only thrown when the
plugin itself is loaded twice (double install, roadmap 6.4).

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
YouTube watch URLs (5.2) are enriched into a markdown document (oEmbed +
meta description + public transcript) — config `fetch.video.enabled`
(default `true`); the document is cached as a text page and works with the
core `question` mode once the host provides an LLM client. GitHub URLs (5.3)
are served without scraping: repository/tree/file pages from a shallow clone
(`fetch.github`, clone cap `fetch.github.maxCloneBytes`, cached under
`<stateDir>/github-clones`), PR/issue pages from the keyless GitHub REST API
(public rate limit — `WEB_QUOTA` when exhausted). Note: the DSH
`web_fetch` tool is host-owned (tool-web) — the core's
`question` parameter (LLM answer) is not available for it; only the
adapter-registered core tools expose it.

## Scripts

```sh
pnpm build              # esbuild → lib/index.js (ESM, host deps external)
pnpm test               # vitest (49 tests: schema/config/entry/host adapter/llm + host contract)
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
- The `llm` HostAdapter member (5.4) is the DeepSeek chat-completions client
  from `DEEPSEEK_API_KEY` (optional `DEEPSEEK_BASE_URL`). Without the key it
  is absent and LLM-dependent paths (`web_fetch` `question`, curator
  summaries) fail closed with `WEB_NOT_AVAILABLE`.
- Curator UI (5.4): `extended.curator.enabled: true` registers the
  `web_curator` tool — a token-protected 127.0.0.1 review page for searches
  and pages (Summarize/Discard). Remote access (`extended.curator.remote`)
  is deferred in v0.1 (loopback only).
