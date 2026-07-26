# Аудит честности README — 2026-07-26

Повод: сверка репозитория с внешней продуктовой спецификацией (Hermest Board Product
Specification RU v1.0). Её §17 называет разрыв между маркетингом и кодом отдельным риском,
а Definition of Done требует, чтобы README не обещал неподтверждённые функции.

Метод: каждая строка таблицы `## Feature Matrix (Honest Statuses)` проверена по коду или по
выводу команды. «Подтверждено» означает, что найдены реализация и тест, а не только намерение.

## Итог

Одно утверждение было ложным (обложки), одно вводило в заблуждение (браузерный мост), одно
устарело (число тестов). Остальные подтвердились. Ложное утверждение закрыто не удалением
строки, а реализацией функции.

| Строка матрицы | Вердикт | Доказательство |
|---|---|---|
| Интерактивная доска | подтверждено | `src/app.js`, автосохранение в `localStorage`; тесты доски в `test/unit/` |
| Тема → карточки источников (async draft, отмена) | **уточнено** | Браузерный мост — отдельный локальный сервис на `127.0.0.1:8788`, в этом репозитории его нет. Раньше строка читалась так, будто мост — часть продукта. Код: `src/local-media/draft-job-manager.js`, `src/domain/ai-director.js` |
| Мультиязычная озвучка (Piper/ElevenLabs) | подтверждено | `src/media/narration.js`, `src/media/piper-tts.js`, `src/media/elevenlabs-tts.js`; тайминги от измеренной длительности — `src/domain/content-pipeline.js` |
| Бесплатная генерация фонов (Pollinations) | подтверждено | `src/media/image-source.js:createPollinationsImageAdapter`; ключ не требуется |
| Премиум-визуал (FAL) + сток (Pexels) | подтверждено | Каскад `src/media/broll-providers.js:94`, предупреждения уходят в manifest |
| Детерминированный рендер FFmpeg | **исправлено** | README дважды обещал обложки (`thumbnails` / «обложки»), в коде их не было: артефакты — только `storyboard.json`, `narration.wav`, `narration.srt`, `${recipe.id}.mp4`; поиска `-frames:v`/`vframes` не находил ничего. Теперь обложка реально режется из мастера: `src/domain/cover-frame.js`, `src/media/ffmpeg-args.js:buildCoverFrameArgs`, проверка PNG-заголовком `src/media/png-header.js`, интеграционный тест сверяет размер кадра с рецептом |
| Премиум-композиция (motion, Ken Burns, b-roll, музыка) | подтверждено | `src/media/scene-archetypes.js`, `src/media/music-library.js`, ducking в `src/media/ffmpeg-args.js` |
| BYOK-ключи провайдеров | подтверждено | `src/local-media/provider-keys.js`; ключи только в памяти воркера, `npm run verify:bundle` доказывает отсутствие в бандле |
| Отдельный BYOK ИИ-ассистент | подтверждено | `api/ai/respond.js`, `src/media/openai-text-model.js` |
| Service worker | подтверждено | `sw.js`, кеширование только хешированных `/assets/` |
| Возобновление задач после перезагрузки | подтверждено | `src/local-media/job-manager.js`, идентификаторы в `localStorage` |
| Блок аналитики рендера | подтверждено, но имя опасное | `deriveRenderAnalytics` — `src/local-media/job-manager.js`; это телеметрия рендера (длительность, LUFS, размер, SHA-256), **не** аудиторная аналитика §8 спецификации. Разведено в `docs/CONTENT_PIPELINE_SPEC.md` §11.2 |
| Хранилище воркспейса (SQLite) | подтверждено | `src/workspace/workspace-store.js:1` (`node:sqlite`), схема `src/workspace/migrations/0001_initial_schema.sql` |
| CI Gate | **обновлено** | Было «580+ unit», фактически 798 (`npm run test:unit`, 0 падений на дату аудита) |
| Docker (статический SPA) | подтверждено | `Dockerfile`, `docs/DEPLOYMENT.md` |
| Self-host образ (полный рендер) | подтверждено | `Dockerfile.selfhost`, `.github/workflows/selfhost-image.yml` |
| Semantic shorts | подтверждено как PLANNED | Вертикальный рендер есть (`src/domain/platform-recipes.js`), семантического ремикса нет |
| Мультиязычные редакции | подтверждено | `src/media/edition.js`, статусы включая `voice_missing` |
| Автопубликация в соцсети (PARTIAL) | подтверждено | `api/connectors/callback.js:30` — `oauth_token_exchange_not_implemented`; статусы площадок `src/publishing/platform-status.js` |
| Долговременное хранилище / мультитенантность (PARTIAL) | подтверждено | `api/_lib/storage-adapters/postgres.js` (generic-таблица `hermest_records`), запись по умолчанию выключена |
| Биллинг / квоты (PLANNED) | подтверждено | Реализации нет |

## Смежная находка (не строка матрицы)

`db/postgres-schema.sql` описывает типизированные таблицы (`projects`, `assets`, `jobs`,
`connectors`, `audit_events`), но рантайм их не использует: `api/_lib/storage-adapters/postgres.js`
пишет в одну generic-таблицу `hermest_records` с колонкой `collection`. Это не дефект —
типизированная схема явно помечена как DRAFT будущей фазы (`docs/DATABASE_SCHEMA_DRAFT.md`), —
но легко принять её за действующую. Аудит вёлся с этой поправкой; сам аудит журнала не пишет:
`appendAudit` (`api/_lib/storage.js:113`) работает и вызывается из 14 мест `api/product.js`.
