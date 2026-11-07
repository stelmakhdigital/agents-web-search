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

Channel: **git** — the packages are not published to npm. The repo is
self-contained: the pinned core (`.vendor/agents-web-search-core-1.0.0.tgz`)
and the prebuilt DSH bundle (`packages/dsh/lib/`) ship inside it, so a
fresh clone installs offline.

### DSH

```sh
git clone https://github.com/stelmakhdigital/agents-web-search.git
# in a DSH profile (a dir with package.json + pnpm-workspace.yaml):
dsh plugin --profile <profile> add file:/path/to/agents-web-search/packages/dsh
dsh --profile <profile> --dump-config   # verify: web seam patched (multi/cached-http)
# update: git -C … pull + dsh plugin --profile <profile> update
```

No one-command `dsh plugin add git+https://…`: `dsh plugin add` is a
forwarder to `pnpm add`, and pnpm resolves `file:` dependencies inside a
git package relative to the **consuming project** (the profile), not the
clone (verified on pnpm 11.7). Clone + `file:` is the reliable,
E2E-verified path.

The plugin registers the core's search/fetch providers into the `web` seam
(ids `multi`/`cached-http`) plus the adapter tools
(`get_search_content`, `web_platform_search`, `web_history`,
`web_search_stats`, `web_cache_clear`, `browser_*`). The host's
`tool-web` keeps `web_search`/`web_fetch`; the bundle pin
(`searchProvider: multi`, `fetchProvider: cached-http`) routes them to the
core. Built-in DSH web packages coexist safely (different provider ids;
the pin resolves ambiguity) — see the Incompatibilities section.

### Pi

Pi installs a git repo in **one command** (it clones into its install dir
and runs `npm install` itself):

```sh
pi install https://github.com/stelmakhdigital/agents-web-search.git@v1.4.7   # user scope
pi install -l https://github.com/stelmakhdigital/agents-web-search.git@v1.4.7  # project scope
pi list
# update: pi update (for a pinned ref — fetch origin <ref>)
```

The extension registers all core tools (including `web_search`/`web_fetch`);
optional config — `~/.pi/agent/web-search.json`, state —
`~/.pi/agent/web-search/`.

**Браузер по умолчанию**: Playwright-модуль включён из коробки
(`browser.enabled: false` — чтобы выключить). После установки скачайте
браузер один раз: `agents-web-search/scripts/browser/install.sh` (использует
playwright установленного адаптера) или `npx playwright install chromium`.
На `session_start` адаптер проверяет готовность (`browserReadiness()` ядра)
и при отсутствии браузера даёт одно предупреждение с точной командой
лечения; подтверждения действий — по `approval` (fail-closed), см.
`packages/pi/README.md`.

#### SearXNG (локальный инстанс)

Дефолтная цепочка движков — `searxng, ddg, bing`: сначала ядро пробует
**локальный SearXNG** (метапоиск без облачных API и дата-брокеров), затем
падает в безключевые публичные движки. Инстанс необязателен: если он не
поднят, поиск просто идёт через `ddg`/`bing` (refused-соединение отказывается
мгновенно; молчащий хост срезается ~3-секундным connect-гардом, после чего
движок уходит в cooldown).

Установка одной командой (нативно, без docker: Python venv + systemd
**user** unit, bind `127.0.0.1:8080` — `SEARXNG_DEFAULT_ENDPOINT` ядра):

```sh
git clone https://github.com/stelmakhdigital/agents-web-search.git \
  && agents-web-search/scripts/searxng/install.sh
```

Скрипт: создаёт venv в `~/.pi/agent/web-search/searxng/venv`, клонирует
официальный репозиторий SearXNG (PyPI-пакет `searxng` — посторонний
MCP-сервер, не используется), ставит движок + waitress, генерирует
минимальный `settings.yml` (`search.formats: [html, json]`,
`limiter: false`, `valkey.url: false`, персистентный secret key) и запускает
`searxng.service` как systemd user unit. Идемпотентен; `update` подтягивает
свежий исходник (rolling release), `status` — состояние юнита и пробы,
`uninstall` удаляет всё. Нужны python ≥ 3.9 и git; без systemd user-сессии
скрипт печатает команду ручного запуска.

**Health-check на старте**: на `session_start` (reason `startup`, один раз
на процесс pi, без субагентских процессов) адаптер проверяет
`{endpoint}/healthz` с таймаутом 800 мс, fire-and-forget — старт сессии не
блокируется. Мёртвый инстанс даёт одно предупреждение: `agents-web-search:
SearXNG недоступен на <endpoint> — поиск пойдёт через ddg+bing …` с
подсказкой запуска install-скрипта; кроме TUI-предупреждения модель получает
пояснение в первом результате `web_search` (сессия-запись
`web-search-searxng-down`). Endpoint берётся из
`providers.searxng.endpoint` или из дефолта ядра. Отключить проверку —
убрать `searxng` из `search.engines` в `web-search.json` (не заданный
`search.engines` наследует дефолтную цепочку ядра, где searxng есть).
Подробности: `packages/pi/README.md`.

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
