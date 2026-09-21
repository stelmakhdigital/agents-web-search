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

The core is referenced as a local tarball (`file:.vendor/core-*.tgz`); re-run
`pnpm pack:core` whenever the core changes. Release mode swaps it for
`@agents-web-search/core: ^<version>` from the npm registry.

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
