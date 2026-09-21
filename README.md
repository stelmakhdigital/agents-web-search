# agents-web-search

Agent adapters for the agent-agnostic web-search core
[`@agents-web-search/core`](https://github.com/stelmakhdigital/core-web-search).

One npm package per agent (`@agents-web-search/<agent>`); each package is a thin
HostAdapter implementation (ADR-002) over the host's own extension mechanism —
all search/fetch/store/platform logic lives in the core, never in an adapter.

## Packages

| Package | Agent | Mechanism |
|---|---|---|
| `packages/dsh` → `@agents-web-search/dsh` | DeepSeek Harness | cordis plugin: seam providers (`web`) + tools + settings section |
| `packages/pi` → `@agents-web-search/pi` | Pi (earendil-works) | extension: `pi.registerTool` + JSON config + 50KB/2000-line truncate |

## Development

```sh
# 1) link the core (dev mode, ADR-001 §3): pack it from the sibling checkout
pnpm pack:core          # or: cd ../core-web-search && npm pack --pack-destination ../../agents-web-search/.vendor/

# 2) install (workspace)
pnpm install --store-dir .pnpm-store

# 3) build / test / typecheck all packages
pnpm build && pnpm test && pnpm typecheck
```

The core is referenced as a local tarball (`.vendor/agents-web-search-core-1.0.0.tgz`,
committed to this repo so a fresh clone is self-contained and installs
offline); re-run `pnpm pack:core` + re-commit the tarball whenever the
core changes (channel: git — decision 2026-09-21, the packages are not
published to npm).

## Install (git channel, decision 2026-09-21)

```sh
git clone https://github.com/stelmakhdigital/agents-web-search.git
```

### DSH

```sh
# in a DSH profile (a dir with package.json + pnpm-workspace.yaml):
dsh plugin --profile <profile> add file:/path/to/agents-web-search/packages/dsh
dsh --profile <profile> --dump-config   # verify: web seam patched (multi/cached-http)
```

`dsh plugin add` is a thin forwarder to `pnpm add` in the profile
directory (any pnpm spec works); a monorepo sub-package is installed via
the clone + `file:` form. Update: `git -C … pull` +
`dsh plugin --profile <profile> update`.

The plugin registers the core's search/fetch providers into the `web` seam
(ids `multi`/`cached-http`) plus the adapter tools
(`get_search_content`, `web_platform_search`, `web_history`,
`web_search_stats`, `web_cache_clear`, `browser_*`). The host's
`tool-web` keeps `web_search`/`web_fetch`; the bundle pin
(`searchProvider: multi`, `fetchProvider: cached-http`) routes them to the
core. Built-in DSH web packages coexist safely (different provider ids;
the pin resolves ambiguity) — see the Incompatibilities section.

### Pi

```sh
pi install /path/to/agents-web-search/packages/pi      # user scope
pi install -l /path/to/agents-web-search/packages/pi   # project scope
pi list
```

The extension registers all core tools (including `web_search`/`web_fetch`);
optional config — `~/.pi/agent/web-search.json`, state —
`~/.pi/agent/web-search/`.

### Writing your own adapter (HostAdapter)

Any agent integrates with the core through the single `HostAdapter`
contract — `identity`, `config`, `paths`, `credential`,
`registerTools` (the core never registers tools itself — the adapter does),
`toHostError`, and the optional `approve` (fail-closed), `llm`
(question mode of `web_fetch`, curator summaries) and `log`/`dispose`
hooks. Full reference + a minimal example: the core's
[README](https://github.com/stelmakhdigital/core-web-search#how-to-write-your-own-adapter-hostadapter)
(«Как написать свой адаптер (HostAdapter)»). Adapters are thin (ADR-002):
type/config/path/error mapping only — all logic lives in the core. The
shared contract suite for new adapters: `runHostContractTests`
(`packages/contract`, 12 checks).

## Incompatibilities (roadmap 6.4, verified 2026-09-21)

- **DSH: `WEB_DUPLICATE_PROVIDER`.** The DSH web seam throws it when two
  providers with the same id are registered. Our provider ids are
  `multi`/`cached-http`, so the built-in DSH web packages (ids `http`,
  `deepseek`, …) do NOT collide with this plugin — and the plugin bundle pins
  the seam to `searchProvider: multi` / `fetchProvider: cached-http`, which
  also resolves `WEB_PROVIDER_AMBIGUOUS` (multiple usable providers, no pin).
  The real duplicate trigger is the plugin being **loaded twice** (double
  install, e.g. both a profile dependency and a bundle entry); `apply()`
  then re-throws a `WEB_DUPLICATE_PROVIDER` with an actionable message
  (tested in `packages/dsh/test/index.test.ts`).
- **Pi: tool-name conflicts.** If another installed extension registers a
  tool with the same name (e.g. `web_search`), Pi **fails fast at startup**
  with `Tool "web_search" conflicts with <path of the other extension>` plus
  a hint — verified end-to-end with a second extension registering
  `web_search` (Pi 0.86.0). There is no silent override; the user sees both
  package paths immediately.
- **Core double install (npm vs git / file:).** The core keeps no mutable
  global state (only immutable module-level constants), so two core
  instances side by side are behaviourally safe: each adapter owns its own
  `WebStore` (SQLite in the host's state dir) and stack. The remaining risk
  is a **version skew** between an adapter and the core it links — mitigated
  by exact-version pins in the workspace (`.vendor` tarball) and, from phase
  7, by `^0.1`-exact ranges in the published packages.

## Commits

This directory is its own git repository (branch `master`); commit from inside
it and push after each commit (GitHub: `stelmakhdigital/agents-web-search`).
