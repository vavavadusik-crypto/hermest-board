# Hermest Board — Content Pipeline Specification

Дата: 2026-07-13
Статус: TARGET CONTRACT / CURRENT AUTHORITY

## 1. Pipeline

```text
intake → research → evidence → outline → script → storyboard
→ assets → narration → timeline → render → qc → approval
→ package/publish → observe → iterate
```

Каждая стадия получает versioned input, создаёт immutable output artifact и blocker list. Стадия не может повышать status только по exit code.

## 2. States

```text
draft
researching → research_ready | blocked
scripting → script_ready | blocked
storyboarding → storyboard_ready | blocked
preparing_assets → assets_ready | blocked
rendering → render_ready | failed | cancelled
quality_check → waiting_for_approval | blocked
approved → publishing | packaged
publishing → published | delivered_to_inbox | unknown | failed
```

`unknown` после внешнего side effect требует reconciliation, не blind retry.

Этот список — TARGET, а не то, что живёт в коде сегодня. Фактические статусы рантайма и мост
к состояниям продуктовой спецификации — в §11 «State vocabulary».

## 3. Core project contract

```json
{
  "schemaVersion": 1,
  "projectId": "opaque-id",
  "title": "string",
  "brief": {
    "topic": "string",
    "audience": "string",
    "language": "ru",
    "tone": "documentary",
    "masterDurationSeconds": 1200,
    "platforms": ["youtube_video", "youtube_shorts", "tiktok", "instagram_reels"]
  },
  "cards": [],
  "links": [],
  "sources": [],
  "script": {},
  "storyboard": {},
  "renderRecipes": [],
  "publishCandidates": []
}
```

Existing board JSON remains importable. Migration adds fields; it must not destroy unknown safe fields.

## 4. Evidence cards

A `source` card stores provider, canonical URL, title, retrieved timestamp, publisher/author where known, license/rights metadata and extraction hash. A `fact` card stores statement, source refs, confidence, contradiction refs and human notes. Generated explanation must not masquerade as a sourced fact.

## 5. Storyboard contract

Each scene has:

```json
{
  "id": "scene-001",
  "order": 1,
  "title": "Opening hook",
  "narration": "...",
  "durationMs": 6000,
  "visual": {
    "assetRef": "asset-or-null",
    "fallbackStyle": "title-card",
    "motion": "slow-zoom"
  },
  "sourceRefs": ["source-001"],
  "subtitleMode": "burn_and_sidecar",
  "blockers": []
}
```

Durations are estimates before narration and measured after TTS. Timeline reconciliation may adjust scene holds without changing narration text.

## 6. Asset contract

Every asset records:

- immutable ID/content hash;
- type/MIME/bytes/dimensions/duration;
- origin: uploaded/found/generated/rendered;
- source URL/provider/model/prompt where applicable;
- rights status: `unknown|allowed|restricted|owned|generated`;
- local/object-storage reference;
- safety/probe status;
- parent artifacts.

Unknown or restricted assets block public candidate creation unless replaced or explicitly licensed.

## 7. Audio/subtitle contract

Narration artifact records provider, model/voice, language, measured duration, sample rate/channels, script hash and pronunciation warnings. Subtitle cues derive from narration timing where available; a deterministic fallback distributes timings by sentence/word weight and marks timing quality.

## 8. Render recipe

Recipe specifies canvas, fps, codec/container, audio loudness target, subtitle layout, transition policy, safe zones, max duration and segmentation strategy. First built-in recipes:

- `youtube-16x9-1080p`;
- `shorts-9x16-1080p`;
- `tiktok-9x16-1080p`;
- `reels-9x16-1080p`.

Shorts are semantic editions with their own hook/CTA; naive fixed-window chopping is not accepted as final adaptation.

## 9. Manifest

Every run writes a manifest with:

- input/project/storyboard hashes;
- tool/runtime versions;
- provider/recipe versions;
- command argv (redacted, no secrets);
- artifacts, hashes, bytes, dimensions, streams, duration;
- tests/QC results;
- blockers/warnings;
- parent/child lineage.

## 10. Quality gates

Before local approval:

- JSON/schema valid;
- all scenes have narration and visual fallback;
- `ffprobe` confirms expected streams/dimensions/duration;
- no zero-byte or missing artifact;
- subtitles parse and fit timeline;
- asset provenance/rights visible;
- output hash recorded;
- no secret or local credential path in manifest.

Before publication additionally require connector readiness, exact approval, current platform policy and immutable candidate match.

## 11. State vocabulary

### 11.1 Канон

В проекте одновременно живут три словаря состояний, и это нормально ровно до тех пор, пока
известно, какой из них чему служит. **Каноническим для кода является рантаймовый словарь** —
статусы, которые реально присваиваются джобам, кандидатам и записям хранилища (§11.3); только
на них можно опираться в реализации, тестах и API-контрактах. **Каноническим для продуктового
разговора является §6.6 внешней продуктовой спецификации** (`DRAFT · RESEARCHING · PLANNING ·
GENERATING · ASSEMBLING · REVIEW_REQUIRED · APPROVED · PUBLISHING · PUBLISHED/PARTIAL ·
ANALYZING`) — на этом языке описывается продукт наружу. Словарь §2 этого документа — TARGET
CONTRACT, желаемое состояние пайплайна, а не описание сегодняшнего кода. Мостом между
продуктовым и рантаймовым словарями служит **исключительно таблица §11.2**: любое утверждение
вида «у нас есть состояние X» проверяется по ней, а не по §2 и не по памяти.

### 11.2 Мост: продуктовая спецификация → стадия пайплайна → код

| Состояние продуктовой спецификации (§6.6) | Стадия нашего пайплайна (§1/§2) | Фактический статус в коде |
|---|---|---|
| `DRAFT` | intake; §2 `draft` | `content_items.status` по умолчанию `draft`, CHECK-список `draft·in_progress·review·approved·published` — `src/workspace/migrations/0001_initial_schema.sql:50`. Языковая редакция: `EDITION_STATUSES.DRAFT` — `src/media/edition.js:15`. Сама доска статуса не хранит вообще: состояние лежит в `localStorage` без поля `status` — `src/app.js:630` |
| `RESEARCHING` | research/evidence; §2 `researching → research_ready` | Draft-job: `queued` (`src/local-media/draft-job-manager.js:40`) → `running` (:80) → `completed` (:89) \| `failed` (:97) \| `cancelled` (:74, :94). Отдельного `research_ready` нет — успех выражается как `completed` |
| `PLANNING` | outline/script/storyboard; §2 `scripting`, `storyboarding` | **Собственного статуса нет.** Сценарий и storyboard собираются синхронно внутри `running` соответствующей джобы (`src/domain/content-pipeline.js`, вызывается из `src/media/render-project.js`). Ни `script_ready`, ни `storyboard_ready` в коде не встречаются |
| `GENERATING` | assets/narration; §2 `preparing_assets → assets_ready` | Render-job `running` — `src/local-media/job-manager.js:137`. Детализация — не статус, а progress phase из закрытого набора `preflight·scenes·audio·encode·finalize` (`src/local-media/job-manager.js:628`), плюс `queued` при submit (:63) и `done`, который ставит только сам менеджер и только на `completed` (:171). `assets_ready` в коде нет |
| `ASSEMBLING` | timeline/render; §2 `rendering → render_ready` | Та же render-job в `running`, фазы `encode`/`finalize` (`src/local-media/job-manager.js:628`); завершение — `completed` (:162) строго после обязательного QC-гейта `requirePassedRenderQc` (:311, требует `manifest.qc.passed === true`). Отказ — `failed` (:177), отмена — `cancelled` (:174). `render_ready` в коде нет |
| `REVIEW_REQUIRED` | qc/approval; §2 `quality_check → waiting_for_approval` | `waiting_for_approval` — **единственный** статус из §2, который реально присваивается: `jobStatusFromPlan` (`api/product.js:981-983`) при создании job (`api/product.js:589`). При непустых blockers вместо него `blocked` (там же). Отдельного `quality_check` нет: QC автоматический и блокирует переход в `completed` |
| `APPROVED` | approval; §2 `approved` | Решение человека пишется в `approval.status = "approved" \| "rejected"` — `api/product.js:667`. Статус самой job при одобрении становится **`blocked`**, а не `approved` (`api/product.js:683`); `execution.status` — `blocked_after_approval` (:686). Это осознанный fail-closed, а не дефект: автопубликации нет |
| `PUBLISHING` | package/publish; §2 `publishing` | **Статуса `publishing` в коде нет.** Есть статус кандидата: `sealed` (`api/_lib/publish-candidates.js:57`, `src/local-media/job-manager.js:428`) либо `blocked` (`src/local-media/job-manager.js:436`); не-`sealed` кандидат отбивается 409 `candidate_not_sealed` (`api/_lib/publish-candidates.js:79`, `api/product.js:864`). Переход job в `running`/`completed` намеренно закрыт 409 `job_execution_blocked` (`api/product.js:1006-1012`), пока `canAutopublish === false` (`api/product.js:688`, :990 — константа) |
| `PUBLISHED` / `PARTIAL` | observe; §2 `published \| delivered_to_inbox \| unknown \| failed` | Реально существует только статус чека публикации: `success \| failed \| pending` (`src/publishing/publish-contract.js:41`) в режимах `draft \| live` (:40). Доступна ровно одна площадка — `webhook_export` (`src/publishing/platform-status.js:10`), у остальных `available: false`. `content_items.status = 'published'` есть как допустимое значение CHECK (`src/workspace/migrations/0001_initial_schema.sql:50`), но автоматически его не выставляет никто — только явный вызов workspace API. `delivered_to_inbox`, `unknown`, `packaged` в коде отсутствуют полностью |
| `ANALYZING` | observe/iterate | **Нет реализации.** Аудиторной аналитики в проекте нет вовсе. `job.analytics` (`src/local-media/job-manager.js:168`, отдаётся наружу только на `completed` — :478) — техническая телеметрия рендера, деривированная из уже проверенного manifest (длительность, LUFS, размер, число сцен, SHA-256), а не просмотры/удержание/CTR. `analytics.read` (`src/ui/connector-labels.js:16`) — только подпись OAuth-scope в UI: ни адаптера, ни хранилища за ней нет |

### 11.3 Фактические рантаймовые словари (полный перечень)

Это то, что действительно присваивается и проверяется в коде. Ничего сверх этого списка нет.

| Словарь | Значения | Где |
|---|---|---|
| Render job | `queued · running · completed · failed · cancelled` | `src/local-media/job-manager.js:55, 137, 162, 174, 177` |
| Render progress phase (не статус) | `queued · preflight · scenes · audio · encode · finalize · done` | `src/local-media/job-manager.js:63, 628, 171` |
| Draft job (wizard) | `queued · running · completed · failed · cancelled` | `src/local-media/draft-job-manager.js:9, 40, 80, 89, 94, 97` |
| Publish candidate | `sealed · blocked` | `api/_lib/publish-candidates.js:57`; `src/local-media/job-manager.js:428, 436` |
| Candidate evidence | `metadata_only · server_verified` | `api/_lib/publish-candidates.js:9`; `src/local-media/candidate-persistence.js:68` |
| Product API job | `queued · running · waiting_for_approval · blocked · failed · completed · cancelled` (принимаются валидатором); реально достижимы `waiting_for_approval`, `blocked`, `cancelled` — `running`/`completed` закрыты 409 до появления автопубликации | `api/product.js:27-34, 589, 683, 1006-1012` |
| Product API approval | `pending · blocked · approved · rejected` | `api/product.js:667, 988` |
| Product API execution | `blocked_after_approval · rejected_by_human` | `api/product.js:686` |
| Agent plan | `ready_for_human_approval · blocked_until_connectors_and_storage`; по провайдеру `ready · blocked` | `api/product.js:581`; `api/_lib/agent-plan.js:81` |
| Publish receipt | `success · failed · pending`; режимы `draft · live` | `src/publishing/publish-contract.js:40-41` |
| Edition (языковая редакция) | `draft · translating · ready · voice_missing · error` | `src/media/edition.js:14-20` |
| Connector capability | `ready · blocked · configured_but_adapter_missing` | `api/_lib/connector-capabilities.js:158-180` |
| Connector record | `connected · expired · revoked · error` | `api/product.js:37` |
| Asset rights | `unknown · allowed · restricted · owned · generated` | `api/product.js:35` |
| Workspace SQLite | `clients: active·archived` · `projects: active·archived·completed` · `campaigns: draft·active·completed·cancelled` · `content_items: draft·in_progress·review·approved·published` · `render_jobs`/`publish_jobs: queued·running·completed·failed·cancelled` | `src/workspace/migrations/0001_initial_schema.sql:9, 21, 35, 50, 74, 88` |

### 11.4 Чего в коде нет

Проверено сплошным поиском по `src/` и `api/`: следующие состояния §2 не встречаются нигде —
`research_ready`, `script_ready`, `storyboard_ready`, `assets_ready`, `render_ready`,
`quality_check`, `packaged`, `delivered_to_inbox`, `unknown` (как статус пайплайна; строка
`"unknown"` в коде используется только как значение прав на ассет и как имя неизвестного актора).
Из состояний §6.6 без какой-либо реализации остаётся `ANALYZING`.
