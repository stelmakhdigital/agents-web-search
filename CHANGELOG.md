# Changelog — agents-web-search

Адаптеры агентов для `@agents-web-search/core`. Формат — Keep a Changelog;
версии пакетов синхронизированы (`dsh`, `pi`; `contract` — внутренний,
private).

## [1.0.1] — 2026-09-21

Git-канал дистрибуции (решение пользователя 2026-09-21: пакеты **не
публикуются в npm**; имена `@agents-web-search/*` сохранены как
идентификаторы).

### Добавлено

- Корневой `package.json` → установочный пакет
  `@agents-web-search/adapters`: DSH-плагин (`main:
  packages/dsh/lib/index.js` + `dsh.bundle.patch`) и Pi-extension
  (`pi.extensions: packages/pi/extensions`) в одном пакете.
- Self-contained клон: pinned core-тарбол (`.vendor/`) и предсобраный
  DSH-бандл (`packages/dsh/lib/`) в git — установка офлайн.
- Установка: Pi — одна команда из git
  (`pi install https://github.com/stelmakhdigital/agents-web-search.git@v1.0.1`
  — Pi сам клонирует и делает `npm install`); DSH — клон +
  `dsh plugin add file:<клон>/packages/dsh` (pnpm git-спец не работает:
  pnpm резолвит `file:` внутри git-пакета относительно проекта-потребителя
  — проверено на pnpm 11.7). E2E: свежий клон из GitHub → DSH
  `--dump-config` (seam pinned, без DUPLICATE/AMBIGUOUS) + Pi-инструмент
  через mock LLM.

### Изменено

- `@agents-web-search/contract` (devDep dsh/pi): `workspace:*` →
  `file:../contract` (npm-совместимость git-установки; npm не парсит
  pnpm-протокол `workspace:`).
- Корневой `package.json`: удалён `workspaces` (npm при git-установке
  строил ideal tree по workspace-пакетам и падал в arborist; pnpm читает
  `pnpm-workspace.yaml`, dev-файл не затронут); peer-зависимости
  (`@deepseek-ai/*`, `@earendil-works/pi-coding-agent`) —
  `peerDependenciesMeta: optional` (их даёт хост).
- identity-версии адаптеров: `1.0.1`.

## [1.0.0] — 2026-09-21

Первый стабильный релиз адаптеров (фазы 4–7). Требуемая версия core:
`@agents-web-search/core@^1.0.0` (exact-пин 1.0.0 до появления v1.x-патчей).

### Добавлено (с 0.1.0)

- **DSH-адаптер**: extended fetch-маппинг в конфиг (PDF/YouTube/GitHub/
  curator), `HostAdapter.llm` (DeepSeek chat-completions, env
  `DEEPSEEK_API_KEY`), браузерные инструменты (`browser_*`) при
  `browser.enabled`.
- **Pi-адаптер**: LLM через `ctx.modelRegistry.complete` (последний
  tool-exec context), браузерные инструменты, конфиг
  `~/.pi/agent/web-search.json`.
- **CI (6.1)**: node 22; core checkout → `npm pack` → `.vendor` →
  `pnpm install --no-frozen-lockfile` → `pnpm -r run
  build/typecheck/test`; `typecheck:host` — только локально (нужен полный
  DSH checkout), в CI не входит.
- **Несовместимости (6.4)**: DSH `WEB_DUPLICATE_PROVIDER` — точное
  actionable-сообщение (реальный триггер — double-install плагина;
  built-in web-пакеты не конфликтуют: разные provider ids + pin снимает
  `WEB_PROVIDER_AMBIGUOUS`); Pi tool-name conflict — fail-fast при старте
  (проверено E2E, Pi 0.86.0); core double-install — безопасен.
- **README (7.1)**: EN + RU — установка (DSH: `dsh plugin add npm:/file:`;
  Pi: `pi install npm:/-l`), «как написать свой адаптер» (HostAdapter),
  несовместимости; DSH-пакет README: секция Install.

### Изменено

- DSH-адаптер: сообщение о `WEB_DUPLICATE_PROVIDER` исправлено (было
  неточное «mutually exclusive with built-in» — built-in не конфликтуют).
- README пакета `dsh`: исправлено устаревшее 6.4-заявление.

### Тесты и качество

- `dsh` 49/49 (37 + 12 контракт), `pi` 50/50 (38 + 12 контракт),
  `contract` 14/14 (self-check на фейк-харнессе).
- E2E-дым (6.2): реальная установка в DSH-профиль (`dsh plugin add`,
  `--dump-config`, boot Web UI 127.0.0.1:3180) и в Pi
  (`pi install` + tool-call через mock LLM).

## [0.1.0] — 2026-09-20

Начальная версия (фаза 4): `@agents-web-search/dsh` (cordis-плагин: seam-
провайдеры `multi`/`cached-http`, инструменты, settings-секция, local-
overlay-пин), `@agents-web-search/pi` (extension: `pi.registerTool` +
typebox + truncate 50KB/2000 строк), `packages/contract` (внутренний
контракт `runHostContractTests`, 12 проверок HostAdapter).
