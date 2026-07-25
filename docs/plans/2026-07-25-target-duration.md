# План: свободная целевая длительность + верхняя командная строка

Ветка `feat/target-duration`, отдельное рабочее дерево `workspace/hermest-board-duration`.

## Замеренная база

Прогон `examples/ai-subscriptions-60s.ru.json`, голос `ru_RU-dmitri-medium`:
141 слово, 774 непробельных символа, чистой речи 48.25 с, 17 предложений,
`sentence_silence 0.35`. Темп предсказуем по символам: **62.3 мс на непробельный
символ** (разброс по сценам 58.9–66.2, ±6%). «Мс на слово» скачет 306–397 (±13%)
и для расчёта непригодно — бюджет считаем в символах.

## Часть A — домен решает, media исполняет

Новый модуль `src/domain/duration-plan.js` (чистые функции, без I/O):

- `normalizeTargetDurationSeconds(value)` — враждебный ввод: тип, NaN, Infinity,
  коридор 15…3600 с. `undefined/null/""` → `null` (текущее поведение).
- `normalizeLengthScale` / `clampLengthScale` — коридор 0.85…1.15.
- `countNarrationCharacters`, `estimateNarrationDurationMs`,
  `estimateNarrationCharacters` — символьный бюджет.
- `deriveSceneCountFromDuration` — число сцен из длительности.
- `planTargetDuration({ targetDurationSeconds, measuredSceneDurationsMs,
  lengthScale, allowResynthesis })` → `{ status, paddingMs, lengthScale,
  projectedDurationMs, deviationMs, warning }`.
- `describeDurationBudget` — «нужно N символов, сейчас M» для UI и предупреждений.

Алгоритм `planTargetDuration`:

1. `rawPadding = (target − измереннаяРечь) / числоСцен`.
2. `rawPadding ∈ [150, 1500]` → `status: "on_target"`, пересинтеза нет.
3. Иначе, если пересинтез разрешён и адаптер умеет темп:
   `scale = текущийScale × (target − сцены×400) / измереннаяРечь`, зажать
   в 0.85…1.15 → `status: "resynthesize"`.
4. Иначе зажать padding в коридор и проверить допуск ±0.5 с; промах →
   `status: "out_of_range"` с конкретным предупреждением в символах.

Media-слой (`src/media/render-project.js`) только исполняет: синтез сцен вынесен
в локальный хелпер, вызывается максимум дважды (второй раз — с новым
`lengthScale`). `paddingMs` уходит в `reconcileStoryboardWithSceneDurations`.
`src/media/piper-tts.js` получает `--length_scale` (массив argv, `shell:false`),
флаг добавляется только когда темп отличается от 1.0 — иначе argv и хеши
манифеста остаются байт-в-байт прежними.

`brief.targetDurationSeconds` — опциональное поле. Валидация: HTTP-граница
(`src/local-media/vite-plugin.js`), UI-нормализация (`normalizeBrief` в
`src/app.js`), домен (`normalizeTargetDurationSeconds`).

## Часть B — верхняя командная строка

`index.html`: новая фиксированная секция `.command-bar` под топбаром —
поле темы + свободный ползунок длительности + поле `m:ss` + главная кнопка
+ строка подсказки (`aria-live`) + сворачиваемый блок «Настройки»
(`aria-expanded`/`aria-controls`), куда переезжают язык, голос, TTS-провайдер,
музыка, B-roll, генерация фонов, ИИ-модель, источники и ручное переопределение
числа сцен. `topic-wizard-panel` из боковой панели убирается.

`src/ui/duration-input.js` — чистые функции для UI: `formatDurationLabel`,
`parseDurationLabel` (m:ss ↔ секунды), нелинейная шкала ползунка
`sliderPositionToSeconds` / `secondsToSliderPosition` (мелкий шаг на коротких
длительностях, крупный на длинных), `describeDurationHint`.

## Гейты

`npm run test:unit`, `npm run validate`, `npm run build` — baseline снят до правок.
Новые тесты: попадание в цель, только паузами, с пересинтезом, «текста не хватает»,
зажим `length_scale` по краям, парсинг/форматирование `m:ss`, вывод числа сцен.
