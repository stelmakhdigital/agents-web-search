# Changelog — agents-web-search

Адаптеры агентов для `@agents-web-search/core`. Формат — Keep a Changelog;
версии пакетов синхронизированы (`dsh`, `pi`; `contract` — внутренний,
private).

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
