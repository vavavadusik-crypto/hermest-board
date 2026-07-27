# Hermest Board

[![CI Gate](https://github.com/vavavadusik-crypto/hermest-board/actions/workflows/ci.yml/badge.svg)](https://github.com/vavavadusik-crypto/hermest-board/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

AI content studio: **topic → research → source cards → script/storyboard → live voiceover → real MP4 (16:9 + 9:16) → publish pack**. The local board is the creative control plane; the media worker deterministically assembles real videos via FFmpeg, while browser-based and BYOK AI models write scripts and draw visuals.

One project = one board. Data lives in the browser (`localStorage`); export/import as JSON.

**Wedge:** Research-grounded content with citations (vs. competitors' black-box prompts) + BYOK economics (bring your own API keys, no per-"minute" markup) + transparent pipeline with human approval + locally runnable (privacy + truly free tier).

Russian UI/docs below. Full English docs: `docs/` directory.

---

## See It

![8-second excerpt from an MP4 rendered by Hermest Board: title card, narration subtitles and a live concept map](docs/media/demo-preview.gif)

**This clip was rendered by Hermest Board itself.** It is an 8-second excerpt from a real project
render — the scene order, per-scene timing and burned-in subtitles come from the project storyboard,
and the deterministic FFmpeg pipeline assembled the H.264/AAC MP4 (1920×1080) with the voiceover
track. Nothing here is a mockup or a hand-edited video.

Full renders of the same project, straight out of the pipeline (~18 s each):

- [**16:9 — 1920×1080 MP4**](docs/media/demo-16x9.mp4) (723 KB)
- [**9:16 — 1080×1920 MP4**](docs/media/demo-9x16.mp4) (665 KB)

Both files come from the same project. The 9:16 cut is an honest aspect-ratio reframe, not a semantic
re-edit — see [`docs/RENDER_PIPELINE.md`](docs/RENDER_PIPELINE.md) for that caveat and for everything
the pipeline emits alongside the MP4s (SRT, cover frame PNG, `storyboard.json`, manifest with hashes
and provenance, SHA-256 sidecar).

### Screenshots

From the running app (Russian UI — an English UI is not shipped yet).

| First run | The board |
|:--|:--|
| <a href="docs/media/screenshot-first-run.webp"><img src="docs/media/screenshot-first-run.webp" width="100%" alt="First-run overlay 'Из темы — в готовое видео' with four mode chips and a topic field"></a> | <a href="docs/media/screenshot-board.webp"><img src="docs/media/screenshot-board.webp" width="100%" alt="Demo board 'Почему небо голубое' with six scene cards and the inspector panel"></a> |
| Onboarding overlay on first open: one topic field, and the four ways to run the product — local & free, free key, own key (BYOK), cloud if you want it. Footer states that nothing leaves the machine without your action. | Demo project «Почему небо голубое»: six scene cards on the canvas, and the right inspector with block transform controls plus the project Plan / Roadmap / Video tabs. Auto-save is on. |

| Top command bar | Mobile |
|:--|:--|
| <a href="docs/media/screenshot-topic-to-video.webp"><img src="docs/media/screenshot-topic-to-video.webp" width="100%" alt="Top command bar with a topic field, a free duration slider, an m:ss box and one build button"></a> | <a href="docs/media/screenshot-mobile.webp"><img src="docs/media/screenshot-mobile.webp" width="220" alt="Top command bar stacked into one column on a 390×844 mobile viewport"></a> |
| The permanent top bar: topic field, a free duration slider (15 s … 60 min) with an `m:ss` box and quick marks, and one build button. Under it — how much narration the chosen length needs versus how much the board holds. Scene count, model, BYOK, voice, music and B-roll sit in the collapsed "Настройки" block. | 390×844 viewport. The command bar stacks into one column, the side panel moves below the canvas — no horizontal scrolling. |

---

## Quick Start

**Self-host (full, real MP4 rendering)** — Docker Compose (one command):

```bash
docker compose up
# Open http://localhost:8080
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for full self-host instructions (Docker + bare-metal).

**Local dev** (requires Node.js 20.11+ and `ffmpeg`/`ffprobe` on your system):

```bash
npm install
npm run dev          # local dev server + media worker on 127.0.0.1:5173
```

Open the printed address in your browser. `npm run dev` (not opening `index.html` as a file) starts the local worker, without which video rendering and the "topic → video" wizard won't work.

**GitHub Codespaces** (zero laptop load, cloud dev environment):

1. Click **Code** → **Codespaces** → **Create codespace on main**
2. Wait for container build (~2 min, includes ffmpeg)
3. Terminal auto-runs `npm run dev`
4. Click the forwarded port link (Ports tab, port 5173) → opens Hermest Board in browser

**First run:** On first open, a welcome overlay "From topic to finished video" appears — enter a topic and click "Start" to jump into the wizard. Anytime, the main flow opens via the **"🎬 Topic → Video"** button in the header (opens panel, prefills and focuses the topic field). Welcome shown once (`localStorage` flag).

Full check before commit/deploy (includes real FFmpeg renders):

```bash
npm run check        # validate · unit · smoke:api · media (2 real MP4s) · build · render smoke
```

---

## Feature Matrix (Honest Statuses)

| Feature | Status | Notes |
|---------|--------|-------|
| Interactive board (drag/rotate/scale cards, links, photos) | ✅ VERIFIED | Live in browser, auto-save to `localStorage` |
| Topic → source cards wizard (async draft, cancel) | ✅ VERIFIED | Browser AI bridge — a **separate local service** on `127.0.0.1:8788` (ChatGPT/Gemini/DeepSeek/Perplexity through a logged-in Chrome tab), not shipped in this repo — or any OpenAI-compatible API (Ollama local free, OpenRouter, Groq, Together, etc.) |
| Multilingual voiceover (Piper RU/EN/ES/DE/FR, ElevenLabs BYOK 29+ languages) | ✅ VERIFIED | Language is a project parameter, not hardcoded; timeline/SRT from measured audio duration; loudness normalization (loudnorm) |
| Free visual generation (Pollinations, no key) | ✅ VERIFIED | Opt-in toggle "Generate backgrounds (free, Pollinations)" in render panel |
| Premium visuals (FAL BYOK) + stock fallback (Pexels BYOK) | ✅ VERIFIED | Honest fail-open cascade: FAL → Pollinations → Pexels, each source yields to next with warning in manifest |
| Scene archetypes (12 layouts, chosen from card content) | ✅ VERIFIED | A deck of six identical "headline + paragraph" screens is what this replaces; the vertical is laid out again rather than cropped |
| Cartoon mode (screenplay with a persistent troupe, SVG puppets, 8 poses, 4 sets) | ✅ VERIFIED | Rendered to a real MP4 in CI: appearance is derived from a character id, so the same person keeps one face across a season; scenery draws itself, so no stock lookup and no image generation |
| Series planning with continuity | ✅ VERIFIED | `POST /api/local-media/series` plans a season; each episode is shot from a brief carrying the troupe and the facts earlier episodes handed forward — continuity is data, not model memory. Episode one is told nothing about a past it does not have |
| Editing the board in plain language | ✅ VERIFIED | The model returns operations over the existing board, never a replacement board: an unknown op never lands, a reorder must be a permutation, the last card cannot be removed, and refusals are shown rather than swallowed |
| Text generation through a logged-in CLI (no API key) | ✅ VERIFIED | Verified live with Codex CLI: the subscription is the credential. The command never comes from the request body — only a preset id and a model name do. Presets for claude/ollama/codex/gemini |
| Deterministic FFmpeg render (H.264/AAC MP4, 1920×1080 + 1080×1920 + 1080×1080, SRT, cover frame PNG, manifest with hashes/provenance, SHA-256 sidecar) | ✅ VERIFIED | Cover is cut from the finished master at a deterministic moment — after the opening scene has assembled — verified by its own PNG header and required by the publish pack. Every render goes to a private directory under physical `/tmp`; worker deliberately absent on public Vercel |
| Premium motion composition (branded motion frames, Ken Burns drift, b-roll under transparent overlay, music with auto-ducking under voice) | ✅ VERIFIED | Procedural CC0 music in `assets/music/` |
| BYOK provider keys (ElevenLabs / FAL / Pexels) | ✅ VERIFIED | Keys live only in local worker memory (`process.env`), never in project/`localStorage`/manifest |
| Separate BYOK AI assistant (OpenAI-compatible providers) | ✅ VERIFIED | For queries about current board |
| Service worker (network-first, aggressively caches only hashed `/assets/`) | ✅ VERIFIED | UI updates reach all devices; `/src/` and `/` always fresh |
| Resume in-flight jobs after reload | ✅ VERIFIED | Active draft/render IDs persisted in `localStorage`, reconnect on boot |
| Analytics block (duration/LUFS/size/scenes/voice/format/artifacts/SHA-256, copy summary) | ✅ VERIFIED | Shown on completed renders, hidden without analytics, mobile 375px |
| Workspace storage (SQLite node:sqlite, clients/projects/campaigns/content/assets/jobs/notes) | ✅ VERIFIED | Durable across restarts, JSON import/export intact |
| CI Gate (798 unit + 6 media real FFmpeg + publish + workspace + build + npm audit + smoke, all exit 0) | ✅ VERIFIED | GitHub Actions on every push/PR, public repo = unlimited minutes |
| Docker image (static SPA) | ✅ VERIFIED | `Dockerfile` — frontend only, NO worker (nginx static); [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| Self-host image (full, real MP4 render) | ✅ VERIFIED | `Dockerfile.selfhost` + compose — ffmpeg/chromium/piper worker, all features; CI build proof |
| Semantic shorts (meaning-based scene selection, not just time crop) | ⏳ PLANNED | Vertical render by aspect ratio exists; semantic remixing next slice |
| Multilingual editions (one project → same video in another language: translate narration → language voice → re-render) | ✅ VERIFIED | Deterministic (temperature 0 translation), `voice_missing` when no voice for a language, provenance in manifest; UI "Create edition in [language]". Bulk all-languages + RTL/CJK are follow-ups |
| Auto-publish to social platforms (OAuth token exchange/refresh/revoke) | 🚧 PARTIAL | Skeleton exists, token exchange not implemented: requires durable storage, encrypted tokens, platform review. Board prepares publish pack and action queue; actual publishing after account connections |
| Durable storage / multi-tenant auth | 🚧 PARTIAL | Guarded Postgres foundation + account-auth routes (disabled by default); full SaaS core is separate phase |
| Billing / quotas / metering | ⏳ PLANNED | Not started |

Legend: ✅ VERIFIED (tested, works) · 🚧 PARTIAL (skeleton/foundation exists, core missing) · ⏳ PLANNED (architecture ready, not implemented)

---

## Что умеет

### Доска
Перетаскивание/поворот/масштаб карточек, связи между узлами, фото на карточку, редактирование
текста на месте, план и roadmap проекта, авто-тур с озвучкой, автосохранение и экспорт/импорт JSON.

### Командная строка «тема → видео»
Постоянная **верхняя строка**: поле темы, свободный ползунок длительности (15 с … 60 мин, шаг
1 с на коротких роликах) с полем ручного ввода `м:сс` и одна кнопка. Enter запускает сборку:
ИИ-модель исследует источники и раскладывает карточки прямо на доску. Число сцен считает система
из выбранной длительности; ручное переопределение и остальные параметры — в свёрнутом блоке
«Настройки». Под ползунком видно, сколько закадрового текста требует выбранная длительность и
сколько его есть сейчас. Драфт **асинхронный** (ставится в очередь и опрашивается — долгие
reasoning-чаты не вешают интерфейс), с отменой. Модель выбирается в «Настройках»:

- **браузерный мост** (без API-ключа) — ChatGPT / Gemini / DeepSeek / Perplexity через локальный
  `browser-ai-bridge`, где «ключом» служит залогиненная вкладка Chrome;
- **любой OpenAI-совместимый API** — пресеты OpenRouter / Groq / Together / DeepSeek / Mistral /
  Hugging Face / OpenAI / **Ollama (локально, бесплатно)** или свой URL + ключ.

### Озвучка (мультиязычная)
Провайдер-нейтральный TTS-порт: **Piper** (локально, бесплатно, RU/EN/ES/DE/FR) и **ElevenLabs**
(BYOK, 29+ языков). Язык — параметр проекта, не хардкод. Тайминг сцен и SRT считаются от реально
измеренной длительности озвучки; громкость нормализуется (loudnorm, замер в manifest).

### Визуалы
- **Бесплатная генерация фонов** через Pollinations (без ключа) — включается тумблером
  «Генерировать фоны» в панели рендера;
- **FAL** (BYOK) — премиум-качество, если задан ключ;
- **Pexels** — стоковые фото/видео (BYOK);
- каскад honest fail-open: FAL → Pollinations → Pexels, каждый источник уступает следующему с
  предупреждением в manifest. Без ключей и без тумблера рендер детерминирован и офлайн.
- Премиум-композиция: брендированные motion-кадры (собираются на глазах — каскад появления,
  прорисовка связей схемы), Ken Burns-дрейф статичных фонов, b-roll под прозрачным оверлеем,
  музыкальная подложка с auto-ducking под голос.

### Рендер
Детерминированный FFmpeg → H.264/AAC MP4 (1920×1080, 1080×1920 и 1080×1080), SRT, обложка `<рецепт>.cover.png`,
`storyboard.json`, manifest с хешами/провенансом и SHA-256 sidecar. Обложка режется из готового
мастера в момент, когда первая сцена уже собралась (иначе в кадр попадают недолетевшие элементы),
и проверяется по собственному PNG-заголовку: заявленный размер обязан совпасть с рецептом. Каждый рендер идёт в приватный каталог под
физическим `/tmp`. Worker намеренно отсутствует на публичном Vercel и ничего не публикует.

### BYOK и настройки
Кнопка настроек: ключи провайдеров (ElevenLabs / FAL / Pexels) живут только в памяти локального
worker (в `process.env` процесса) — не попадают в проект, `localStorage` или manifest. Отдельный
BYOK AI-ассистент (OpenAI-совместимые провайдеры) для запросов по текущему борду.

---

## Как работают запросы к ИИ

| Путь | Ключ | Где выполняется |
|---|---|---|
| Браузерный мост (wizard) | не нужен (залогиненная вкладка) | локальный `browser-ai-bridge` :8788 |
| OpenAI-совместимый API (wizard) | свой или бесплатный (Ollama) | локальный worker → провайдер |
| BYOK AI-ассистент | свой | `/api/ai` (Vercel serverless) → провайдер |

Сбой одного провайдера не рушит приложение: каскад визуалов уступает следующему источнику,
драфт возвращает статус `failed` с понятным сообщением, ошибки провайдеров не раскрывают ключи.

### Локальный мост (опционально, для wizard без ключей)
```bash
cd ../browser-ai-bridge
node scripts/login.mjs chatgpt   # войти в открывшемся Chrome (один раз на провайдера)
node src/bridge-server.mjs       # мост на 127.0.0.1:8788
```
Модель по умолчанию для драфта задаётся `HERMEST_BRIDGE_MODEL` (напр. `deepseek`).

---

## Конфигурация (переменные окружения worker/сервера)

Все — опциональны; без них работает бесплатный путь (Piper-голос, Pollinations-фоны, мост/Ollama).

| Переменная | Назначение |
|---|---|
| `HERMEST_ELEVENLABS_API_KEY` | премиум-голос ElevenLabs (BYOK) |
| `HERMEST_FAL_API_KEY` | премиум-генерация изображений FAL (BYOK) |
| `HERMEST_PEXELS_API_KEY` | стоковые фото/видео Pexels (BYOK) |
| `HERMEST_BRIDGE_URL` / `HERMEST_BRIDGE_MODEL` | адрес и модель браузерного моста |
| `HERMEST_PIPER_PATH` / `HERMEST_PIPER_VOICES_DIR` | путь к бинарю и голосам Piper |
| `HERMEST_CHROME_PATH` | Chrome для сборки motion-кадров сцен |
| `HERMEST_SCENE_CAPTURE_WORKERS` | вкладок в пуле захвата кадров, 1..4 (по умолчанию `min(4, ядра - 1)`) |
| `HERMEST_ACCOUNT_AUTH` / `HERMEST_SESSION_SECRET` | включают account-auth роуты (по умолчанию выкл.) |

Секреты — только в окружении/секрет-хранилище, никогда в коде, логах или коммитах.

---

## Состояние и восстановление

Состояние доски (карточки, план, roadmap, brief, настройки) автосохраняется в `localStorage`
браузера и восстанавливается при перезагрузке. Перенос между устройствами/браузерами — кнопкой
экспорта JSON и импортом. Service worker — network-first: обновления UI доходят на все устройства
(агрессивно кэшируются только хэшированные `/assets/`).

---

## Тесты и качество

```bash
npm run test:unit    # быстрые unit-тесты
npm run test:media   # интеграция: 2 реальных FFmpeg-рендера + детерминизм
npm run check        # полный гейт (перед коммитом/релизом)
```

Инварианты: детерминизм (одинаковый вход → одинаковый manifest/хеши; генерация фиксируется
провенансом), fail-closed на отсутствие QC/прав, секреты только в окружении.

---

## Деплой

- **Статический фронтенд** — `npm run build` → `dist/`. Docker-образ (`Dockerfile`) отдаёт `dist`
  через nginx. Образ содержит ТОЛЬКО SPA: media-worker (рендер) и `/api`-функции в него не входят.
- **`/api`-функции** (health, research, AI-прокси, connector/OAuth skeleton, storage-контракт) —
  Vercel serverless (см. `docs/DEPLOYMENT.md`).
- **Media-worker** (рендер видео, wizard-драфт) — только локально через `npm run dev`; намеренно
  не публичен.

Подробности и матрица хостингов — `docs/DEPLOYMENT.md`.

---

## Документация

История и статус изменений — `CHANGELOG.md`. Прочее:

- `docs/PRODUCT_NORTH_STAR.md` — определение продукта · `docs/ARCHITECTURE.md` — архитектура и
  backend boundary · `docs/CONTENT_PIPELINE_SPEC.md` — pipeline/cards/storyboard;
- `docs/MEDIA_RENDERING_ARCHITECTURE.md` — граница TTS/FFmpeg/worker · `docs/CONNECTORS.md` —
  требования площадок · `docs/PUBLIC_APIS.md` — публичные/free API и правила безопасности;
- `docs/STORAGE_AND_AGENT_API.md`, `docs/DATABASE_SCHEMA_DRAFT.md`, `db/postgres-schema.sql` —
  storage-контракт и черновик Postgres · `docs/SECURITY_REVIEW.md`, `SECURITY.md` — безопасность;
- `CHANGELOG.md` — история изменений · `LICENSE` — GNU AGPL-3.0-or-later (сетевой copyleft).

**Гайды пользователя:** [`FAQ`](docs/FAQ.md) · [`Troubleshooting`](docs/TROUBLESHOOTING.md) · [`Backup & Restore`](docs/BACKUP_RESTORE.md) · [`Update & Rollback`](docs/UPDATE_ROLLBACK.md).
**Справочник разработчика:** [`API Reference`](docs/API_REFERENCE.md) · [`Render Pipeline`](docs/RENDER_PIPELINE.md) · [`Manifest Schema`](docs/MANIFEST_SCHEMA.md) · [`Analytics Schema`](docs/ANALYTICS_SCHEMA.md) · [`Migrations`](docs/MIGRATIONS.md).
**Сопровождение:** [`Release Process`](docs/RELEASE_PROCESS.md) · [`Maintenance`](docs/MAINTENANCE.md).

---

## Что намеренно НЕ включено (честные границы)

- **Автопубликация в соцсети** (OAuth token exchange) — skeleton есть, обмен токенов не реализован:
  требует durable-хранилища, шифрованных токенов и platform review. Борд готовит пакет публикации и
  очередь действий; сама публикация — после подключения аккаунтов.
- **Durable-хранилище/мультитенант-auth** — есть guarded Postgres-фундамент и account-auth роуты
  (по умолчанию выключены); полноценное SaaS-ядро — отдельный этап.
- **Semantic shorts** — вертикальный рендер по aspect ratio есть; смысловой перемонтаж — следующий срез.

---

## License

Hermest Board is licensed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE).

**What this means in practice:**

- ✅ **Free to use** for any purpose, including commercial (done-for-you services, paid SaaS tiers, usage packs).
- ✅ **Free to modify and self-host.**
- 🔒 **Network copyleft:** if you deploy a modified version as a public/hosted service, you **must** make your modified source available to its users. Improvements to the hosted product stay open — a competitor cannot fork Hermest Board, close the source, and resell it as a proprietary SaaS.
- 📎 All bundled dependencies are permissive (MIT/ISC/BSD-3-Clause/CC0) and AGPL-compatible — see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The rationale (AGPL vs Apache-2.0) is documented in [`LICENSE_DECISION.md`](LICENSE_DECISION.md).
