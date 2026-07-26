# План: обложка рендера (`<recipeId>.cover.png`)

Дата: 2026-07-26. Ветка: `feat/cover-frame`.

## Проблема

README (Feature Matrix и русский раздел «Рендер») обещает обложки (`thumbnails`),
`src/app.js` требует `thumbnail` / `cover_frame` в чек-листе publish-пака, а конвейер
рендера их не производит: артефакты — только `storyboard.json`, `narration.wav`,
`narration.srt`, `${recipe.id}.mp4`. Обещание должно стать правдой.

## Этапы

1. **Домен.** `src/domain/cover-frame.js` — чистая `resolveCoverFrameSeconds(storyboard,
   { durationSeconds })`. Правило: середина первой сцены (титульная, специально читаемая).
   Клампы `[0.05, duration - 0.05]`; окно схлопнулось → центр ролика. Сцен нет / сцена без
   тайминга → центр ролика. Округление до миллисекунд, чтобы результат был детерминированным.
2. **Билдер argv.** `buildCoverFrameArgs` в `src/media/ffmpeg-args.js`: `-ss` до `-i`
   (быстрый seek), `-frames:v 1 -update 1`, явный `-c:v png`, `scale=W:H`, `-n`,
   `-hide_banner -loglevel error`; обе пути через `assertSafeGeneratedPath`; время — три знака.
3. **Рендер.** `src/media/render-project.js`: после проверки мастер-MP4 снимаем кадр в
   `${recipe.id}.cover.png` (через `.partial` + `rename`, как остальные артефакты), проверяем
   PNG-заголовок и размеры против рецепта, считаем bytes+sha256 через `describeArtifact`,
   добавляем в артефакты манифеста, argv — в `commands`, `cover_frame_extracted` — в `qc.checks`.
   PNG-заголовок разбирается локально (`src/media/png-header.js`), потому что `ffprobe` не
   отдаёт `format.duration` для одиночного PNG и `parseProbeOutput` на нём падает.
4. **Манифест.** Новая команда `cover-frame` (`ffmpeg`) с собственной строгой схемой argv
   в `validateCommandArgv`; обновить `docs/MANIFEST_SCHEMA.md`.
5. **Потребители.** `job-manager` требует обложку в проверенных доказательствах рендера
   (тем самым она попадает и в `verifyArtifactEvidenceOnDisk`); `publish-candidates`
   добавляет approval blocker `cover_frame_artifact_missing`; `src/app.js` считает пункты
   чек-листа `thumbnail`/`cover_frame` выполненными по фактическим артефактам завершённого
   рендера, а не декларативно.
6. **Тесты.** unit: резолвер момента, билдер argv (включая отказ на небезопасном пути),
   валидация манифеста, кандидат публикации, job-manager. Интеграция: реальный PNG —
   сигнатура, ненулевой размер, IHDR-размеры против рецепта, для 16:9 и 9:16.
7. **Документация.** README (Feature Matrix + русский раздел «Рендер»),
   `docs/RENDER_PIPELINE.md`, `docs/MANIFEST_SCHEMA.md`.

## Инварианты

- Ничего не удаляется и не упрощается; контракты только ужесточаются.
- Детерминизм: одинаковый вход → одинаковые байты обложки (проверено на ffmpeg 8.0.1)
  и одинаковый манифест — это держит существующий repeat-тест зелёным.
- Безопасность: только argv, без shell; оба пути — через `assertSafeGeneratedPath`.
