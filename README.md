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

## Commits

This directory is its own git repository (branch `master`); commit from inside
it and push after each commit (GitHub: `stelmakhdigital/agents-web-search`).
