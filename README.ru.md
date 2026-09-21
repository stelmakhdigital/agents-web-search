# agents-web-search

Адаптеры агентов для агностичного ядра веб-поиска
[`@agents-web-search/core`](https://github.com/stelmakhdigital/core-web-search).

Один пакет на агента (`@agents-web-search/<agent>`; npm-идентификаторы
сохранены, но пакеты **не публикуются в npm** — канал дистрибуции: git,
решение 2026-09-21); каждый пакет — тонкая реализация HostAdapter
(ADR-002) поверх собственного extension-механизма хоста — вся логика
search/fetch/store/platform живёт в ядре, никогда в адаптере.

> English: [`README.md`](README.md).

## Пакеты

| Пакет | Агент | Механизм |
|---|---|---|
| `packages/dsh` → `@agents-web-search/dsh` | DeepSeek Harness | cordis-плагин: seam-провайдеры (`web`) + инструменты + settings-секция |
| `packages/pi` → `@agents-web-search/pi` | Pi (earendil-works) | extension: `pi.registerTool` + JSON-конфиг + truncate 50KB/2000 строк |

## Установка (git-канал, решение 2026-09-21)

Канал — **git** (пакеты не публикуются в npm). Клон самодостаточен:
core (pinned `v1.0.0`) лежит в репо тарболом (`.vendor/`), а DSH-плагин —
предсобраным бандлом (`packages/dsh/lib/`) — установка работает офлайн.

### DSH

```sh
git clone https://github.com/stelmakhdigital/agents-web-search.git
# в DSH-профиле (каталог с package.json + pnpm-workspace.yaml):
dsh plugin --profile <профиль> add file:/путь/к/agents-web-search/packages/dsh
dsh --profile <профиль> --dump-config   # проверка: web seam patched (multi/cached-http)
# обновление: git -C … pull + dsh plugin --profile <профиль> update
```

Однокомандного `dsh plugin add git+https://…` нет: `dsh plugin add` —
форвардер в `pnpm add`, а pnpm резолвит `file:`-зависимости внутри
git-пакета относительно **проекта-потребителя** (профиля), а не клона
(проверено на pnpm 11.7). Клон + `file:` — надёжный проверенный E2E путь
(свежий клон → `--dump-config`: web seam pinned, без DUPLICATE/AMBIGUOUS).

Плагин регистрирует search/fetch-провайдеры ядра в seam `web`
(id `multi`/`cached-http`) + адаптерские инструменты
(`get_search_content`, `web_platform_search`, `web_history`,
`web_search_stats`, `web_cache_clear`, `browser_*`). `web_search`/`web_fetch`
остаются за хостовым `tool-web`; пин бандла
(`searchProvider: multi`, `fetchProvider: cached-http`) направляет их на
ядро. Built-in web-пакеты DSH сосуществуют безопасно (другие provider ids;
пин снимает неоднозначность) — см. «Несовместимости».

### Pi

Pi ставит git-репозиторий **одной командой** (сам клонирует в каталог
установки и делает `npm install`):

```sh
pi install https://github.com/stelmakhdigital/agents-web-search.git@v1.0.1   # user scope
pi install -l https://github.com/stelmakhdigital/agents-web-search.git@v1.0.1  # project scope
pi list
# обновление: pi update (для зафиксированного ref — fetch origin <ref>)
```

Extension регистрирует все инструменты ядра (включая `web_search`/`web_fetch`);
опциональный конфиг — `~/.pi/agent/web-search.json`, state —
`~/.pi/agent/web-search/`.

### Как написать свой адаптер (HostAdapter)

Любой агент подключается к ядру через единственный контракт `HostAdapter` —
`identity`, `config`, `paths`, `credential`, `registerTools` (ядро само
инструменты не регистрирует — это делает адаптер), `toHostError`, опционально
`approve` (fail-closed), `llm` (question-режим `web_fetch`, curator-саммари)
и хуки `log`/`dispose`. Полный референс + минимальный пример — в
[README core](https://github.com/stelmakhdigital/core-web-search#как-написать-свой-адаптер-hostadapter).
Адаптеры тонкие (ADR-002): только маппинг типов/конфигов/путей/ошибок —
вся логика в ядре. Общий контракт-тест для новых адаптеров:
`runHostContractTests` (`packages/contract`, 12 проверок).

## Несовместимости (roadmap 6.4, проверено 2026-09-21)

- **DSH: `WEB_DUPLICATE_PROVIDER`.** DSH web seam бросает его, когда
  зарегистрированы два провайдера с одинаковым id. Наши id —
  `multi`/`cached-http`, поэтому built-in web-пакеты DSH (id `http`,
  `deepseek`, …) НЕ конфликтуют с этим плагином — и пин бандла
  (`searchProvider: multi` / `fetchProvider: cached-http`) дополнительно
  снимает `WEB_PROVIDER_AMBIGUOUS` (несколько доступных провайдеров, нет
  пина). Реальный триггер дубликата — **двойная загрузка плагина** (double
  install, например, и dependency профиля, и запись в bundles); `apply()`
  тогда re-throw `WEB_DUPLICATE_PROVIDER` с actionable-сообщением (тест —
  `packages/dsh/test/index.test.ts`).
- **Pi: конфликты имён инструментов.** Если другой установленный extension
  регистрирует инструмент с тем же именем (например, `web_search`), Pi
  **fail-fast при старте**: `Tool "web_search" conflicts with
  <путь-другого-extension>` + подсказка — проверено end-to-end со вторым
  extension (Pi 0.86.0). Нет silent-override; пользователь сразу видит оба
  пути.
- **Двойная установка core (npm vs git / file:).** В core нет мутабельного
  глобального состояния (только immutable константы), поэтому два core-
  экземпляра рядом — поведенчески безопасны: каждый адаптер владеет своим
  `WebStore` (SQLite в state dir хоста) и стеком. Остаточный риск —
  **version skew** между адаптером и его core — митигируется точными
  пинами версии (workspace: `.vendor`-тарбол; с фазы 7 — exact ranges в
  публикуемых пакетах).

## Разработка (dev)

```sh
# 1) подключить core (dev-режим, ADR-001 §3): собрать из соседнего checkout
pnpm pack:core          # npm pack ../core-web-search → .vendor/
pnpm install --store-dir .pnpm-store
pnpm -r run build && pnpm -r run typecheck && pnpm -r run test
# 2) строгая проверка DSH-адаптера против реальных источников DSH:
cd packages/dsh && DSH_HOST=<checkout DSH> npm run typecheck:host
```

Правила workspace: core подключается через `file:../../.vendor/*.tgz`;
host-пакеты (`@deepseek-ai/*`, `@earendil-works/pi-coding-agent`) —
peerDependencies, НЕ ставятся (их даёт хост).

## Коммиты

Коммиты — строго изнутри своего репозитория; документация проекта
(PROJECT_MEMORY/roadmap/AGENTS) живёт в корневом репо рабочего пространства.
