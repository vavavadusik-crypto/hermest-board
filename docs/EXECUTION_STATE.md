# EXECUTION STATE — Hermest Board

> Единственный источник «где мы сейчас». Любой агент на команду «продолжи Hermest Board»
> читает этот файл → `git log -5 --oneline` → `git status --short` → продолжает с NEXT ACTION.
> Протокол непрерывности: `docs/MASTER_PLAN_2026-07-19.md`, раздел 8.6.
> Обновляется в начале каждой задачи и после каждого коммита. Это часть Definition of Done.

UPDATED: 2026-07-24 (одиннадцатая сессия — Gate M4/M5/M6/M7/M8 ЗАКРЫТЫ в облаке; лицензия AGPL-3.0)
ACTIVE PHASE: MLE (мультиязычные ИЗДАНИЯ) — В РАБОТЕ на feat/mle-multilingual-editions (5 срезов, лёгкий гейт зелёный, ждёт cloud CI на реальный edition-MP4; см. секцию MLE ниже). Закрыты 1–8 + 9 (CI offload) — все с CI SUCCESS. NEXT после MLE: PHASE 10 (документация) + PHASE 11 (release candidate).
ВАЖНО (частая путаница): мультиязычная ОЗВУЧКА видео (Piper ru/en/es/de/fr + ElevenLabs, язык = параметр проекта) — ПРОДУКТОВАЯ фича, РАБОТАЕТ, проверена media-гейтом. Отдельно #8 «UI i18n» = язык надписей самого приложения (меню RU↔EN) — системы нет, отложено (owner decision). Это РАЗНЫЕ вещи.
Gate M5 ✅ ЗАКРЫТ @ a322927 (CI SUCCESS): UX/онбординг — санитайз ошибок (src/ui/user-messages.js), панель диагностики провайдеров (src/ui/connector-labels.js), one-click демо (src/ui/demo-project.js), a11y, состояния. Аудит docs/audits/2026-07-24-phase5-ux.md. Owner-decision отложены: #8 UI i18n, #3 визуальный stepper.
Gate M8 ✅ ЗАКРЫТ @ 129499c/e158a39 (CI SUCCESS): security hardening — ssrf-guard+wiring (validateOutboundUrl в respond.js/search.js), redaction, spawn-safety, npm audit в CI, M2 Secure-cookie (X-Forwarded-Proto/HERMEST_FORCE_SECURE_COOKIES), L2 trust-model доки. Аудит LANE B (5 находок, 0 crit/high). Owner-decision: M1 OAuth-state (exchange=501, не живой), M3 tenant-модель, L1 vault-KDF — не блокеры при single-tenant.

## MLE (мультиязычные ИЗДАНИЯ) — В РАБОТЕ на feat/mle-multilingual-editions (не merge; ждёт cloud CI)
Терм. claude (Opus), аддитивно, TDD, минимальные диффы. План: docs/plans/2026-07-24-multilingual-editions.md.
ПРОДУКТОВАЯ фича (не косметика): из ГОТОВОГО проекта собрать ТОТ ЖЕ ролик на языке B — перевести повествование → голос B → тот же монтаж/визуал → отдельный MP4 на языке B. Расширяет уже существующую мультиязычную озвучку в per-project издания. Ключевое: render-project.js и content-pipeline.js НЕ тронуты — издание = переведённый board (`cards` переведены, `brief.language=B`, голос B), прогоняемый через СУЩЕСТВУЮЩИЙ POST /api/local-media/render.
Реализовано 5 срезов (каждый — коммит+push, лёгкий гейт зелёный):
- Slice 1 (6b… нет; 1-й коммит): src/media/edition.js — deriveEditionSegments (1 сегмент/сцена), resolveEditionVoice (piper ru/en/es/de/fr → ElevenLabs → voice_missing с user-safe RU-сообщением, без stack/JSON), createEdition (draft/voice_missing, детерминированный id, форма segments {sceneId,sourceText,translatedText,voiceId}). +9 unit.
- Slice 2: translateEdition (draft→ready/error, санитизированное сообщение), src/media/edition-translator.js (инъектируемая text-model, temperature 0, «translate only»-промпт, снятие кавычек), buildTranslatedProject (переведённое повествование = озвучка, визуал/порядок переиспользованы, piper↔ElevenLabs проводка). Аддитивный проброс temperature в openai-text-model.js/text-model.js (дефолт 0.4 сохранён). +12 unit.
- Slice 3: buildEditionManifest — provenance: targetLanguage, translation model id, voice provider/id, per-segment source+translated sha256, render manifest+video hashes. +3 unit.
- Slice 4: src/local-media/edition-service.js + POST /api/local-media/edition (fail-closed по мосту как draft-service; voice_missing = обычный 200; публичное издание без сырого текста; клиент рендерит через существующий /render). +7 unit.
- Slice 5: UI-триггер (index.html + src/app.js) «Создать издание на [язык ▾]» на завершённом рендере: a11y, role=status, маппинг translating/ready/voice_missing/error без сырых кодов; готовый перевод рендерится через renderLocalVideo(projectOverride) отдельным MP4 (доска не затрагивается). Аддитивные edition-коды в user-messages.js. +3 unit.
Лёгкий гейт (термо-safe): validate ok · 586 unit/0 fail · build exit 0. Baseline был 552 → +34 новых unit.
CI-PENDING (НЕ заявлять done): РЕАЛЬНЫЙ рендер издания-MP4 (полный `npm run check` с ffmpeg/piper — реальная озвучка языка B + отдельный MP4) проверяет облако. Живой перевод через браузерный мост/BYOK локально не гонялся (unit — на мок-переводчике, детерминированно).
STOP-AND-REPORT (follow-up, НЕ в этом срезе): (1) RTL/CJK трансформации текст-боксов + покрытие шрифтов (экранный h1/субтитры для не-латиницы — сейчас h1 = clamped перевод); (2) resume при quota/rate-limit посреди батча; (3) UI ручного редактирования перевода; (4) bulk «все N языков разом» (MVP = один язык за действие); (5) пиксель-идентичный визуал (заморозка seed/asset-хэшей) — сейчас тот же монтаж/структура, но тайминги следуют новой озвучке.
Коммиты на feat/mle-multilingual-editions: edition contract → translation+project → manifest → server route → UI (5 шт, все pushed).

## PHASE 5 (продуктовый UX / онбординг) — В РАБОТЕ на feat/m5-ux-onboarding (не merge; ждёт cloud CI + owner review)
Терм. claude (Opus), аддитивно, минимальные диффы, TDD. Аудит: docs/audits/2026-07-24-phase5-ux.md (10 критериев, file:line; 2 missing, 6 partial, 1 owner-decision). Реализовано 5 срезов (каждый — коммит+push, лёгкий гейт зелёный):
- (#9) Санитайз ошибок: чистый src/ui/user-messages.js (коды/http_*/catalog_* → дружелюбный RU), проводка во все primary-flow error-пути app.js (draft/render/provider/account/AI/dump), job.error через humanizeDetail. +8 unit. Commit c15a1e0.
- (#2/#10) Панель «Диагностика провайдеров»: per-capability готов/настроен/недоступен + человеко-причина из route=connectors/capabilities, бейдж free/paid/no-key/OAuth (join catalog freeMode), состояния loading/empty/error+retry. src/ui/connector-labels.js +7 unit, +1 UI-wiring. Commit 8de7f79.
- (#4) One-click demo: src/ui/demo-project.js (детерминированный «Почему небо голубое», 6 сцен + сценарий + план/roadmap/publish, generateVisuals off = без сети/ключей), через applyProjectDocument. Входы: welcome-оверлей «Открыть пример» + панель wizard. +5 shape +1 wiring. Commit 170a816.
- (#7/#1) a11y: aria-label на 11 иконочных кнопок (＋⛓⌖⚙☰◉⇩⇧⧉×); welcome-оверлей — 4 режима (локально/бесплатный ключ/BYOK/облако) чипами. +2 UI. Commit 0d035e8.
- (#5) Состояния async-панелей: новая диагностика-панель получила полный набор; draft/render/research уже имели loading/empty/error (проверено).
Лёгкий гейт (термо-safe) на последнем срезе: validate ok · 552 unit/0 fail · build exit 0. CI-PENDING (НЕ заявлять done): полный `npm run check` (media/publish/workspace/smoke/verify:bundle) в облаке.
OWNER-DECISION (STOP-AND-REPORT, не трогал): #8 RU+EN i18n — системы нет, с нуля не строим (крупно); #3 полный визуальный stepper пайплайна (сейчас частично: тур + CTA). OAuth/publish/src/media не трогал.

## PHASE 8 (security hardening) — В РАБОТЕ на feat/m8-security-hardening (не merge; ждёт cloud CI)
LANE A round 1 (термин. Sonnet, a555e91+e5b0acf): ssrf-guard.js, error-sanitizer.js, http.js redaction, spawn-safety+bundle-leak тесты, npm audit в ci.yml (блокирующий, `--omit=dev --audit-level=high`, локально 0 vuln).
LANE B аудит (Opus, ec4f373): docs/audits/2026-07-24-phase8-security.md. ⚠️ ПЕРЕПИСАН — прошлая версия (941bbaa, Sonnet) была ГАЛЛЮЦИНАЦИЕЙ: ревьюила несуществующий код (plaintext `new Map()` vault, `randomBytes(32)`+`session.oauthState`, `ensureSessionSync`/`requireWorkspaceId`) и писала «VERIFIED SAFE» по фикции. Переписан на фактах: 5 находок (0 crit/high, 3 medium, 2 low) — M1 OAuth state не single-use/не привязан к сессии (mitigated: exchange=501); M2 session-cookie Secure только на Vercel, не на self-host HTTPS; M3 non-Vercel dev-actor обходит per-record ownership (нет tenant-изоляции без owner-token/session-secret); L1 token-vault KDF fallback = один SHA-256; L2 owner/dev exemption не документирован. Реально проверено SAFE (с file:line): OAuth-крипто (HMAC+timingSafeEqual+nonce), publish fail-closed (canAutopublish всегда false — опроверг ложный «race» FINDING-1), AES-256-GCM vault (опроверг ложный «not implemented» FINDING-2), gated writes, scrypt creds. Находки — на owner review, код НЕ трогал.
LANE A round 2 (Opus, 5f7e8b0+47d86f4): error-sanitizer рекурсия по nested/array (depth-cap 6 + WeakSet cycle-guard) + расширен charset токенов на base64 (+/=) + короткие Bearer; ssrf-guard IPv6 (::1 брекеты были dead-code → loopback вообще не блокировался; fe80::/10, fc00::/7, ::ffff:0:0/96), assertPublicDns (DNS re-check, fail-closed), safeFetch (redirect:manual + ре-валидация Location). Принял тест-контракт параллельной линии (assertPublicDns/safeFetch/IPv6). Решение: короткие/не-в-allowlist секреты НЕ форс-редактим (field-allowlist + entropy-паттерны) во избежание false positives.
Лёгкий гейт (термо-safe): validate ok, 529 unit pass / 0 fail. npm audit 0 vuln.
CI-PENDING (облако должно проверить, НЕ заявлять done): полный `npm run check` (467+ unit + 6 real-ffmpeg media + publish + workspace-integration + build + smoke), блокирующий npm audit в CI. НЕ СДЕЛАНО (честный гэп): safeFetch/assertPublicDns НЕ подключены к живым fetch-сайтам (respond.js/openai-text-model.js/image-source.js всё ещё на inline-проверках) — модуль готов, wiring отдельным шагом. Находки LANE B (M1/M2/M3/L1/L2) ждут решения владельца перед правкой.

## Gate M7 (install/deploy self-host) ✅ ЗАКРЫТ @ b36ce80 (merge) — облачный пруф SUCCESS на 632a307
Терм. claude на feat/m7-selfhost-install (884a526): Dockerfile.selfhost (node:22-bookworm + ffmpeg + chromium + piper через vite preview worker → РЕАЛЬНЫЙ MP4, не только статичный SPA), docker-compose.yml (one-command up, BYOK env passthrough, workspace-data volume), scripts/install.sh (bare-metal Debian/Ubuntu), честная матрица режимов в DEPLOYMENT.md (self-host ✅ render / static ❌ / Vercel ❌), README self-host секция, CHANGELOG, .github/workflows/selfhost-image.yml (облачный пруф: собирает образ + поднимает контейнер + curl HTTP 200).
ГРАБЛЯ «преждевременный done»: терм. claude заявил «Definition of Done: всё выполнено», но его СОБСТВЕННЫЙ CI-пруф упал (не дождался). Ревью-фиксы (Opus): (1) install.sh node-check лексикографический awk «22.1.0 < 20.11» ложно отклонял валидный Node 22 → sort -V semver; (2) .dockerignore целиком резал scripts/ → COPY install-piper-ci.sh падал «not found» → !scripts/install-piper-ci.sh; (3) CMD двойной --host (127.0.0.1 из package.json + 0.0.0.0) → риск loopback-bind → npx vite preview --host 0.0.0.0; (4) runtime не копировал api/ (vite.config → local-media/candidate-persistence → api/_lib/{storage,publish-candidates}.js) → preview-сервер не стартовал → COPY api/; (5) .env.example не документировал self-host BYOK ключи (ELEVENLABS/FAL/PEXELS_API_KEY, читаются compose) → добавлено. Итог: selfhost-image CI SUCCESS на 632a307 (образ собирается + контейнер отдаёт HTTP 200). Ноут холодный — docker build в облаке. НЕ smoke-тестится in-container render (те же ffmpeg/chromium/piper бинарники, что 6 real-MP4 тестов основного gate → claim). Термо-протокол соблюдён; терм. claude трижды падал на обрыве интернета, дошёл на 3-й попытке (чекпоинты между попытками спасли работу).

## Gate M4 (workspace runtime) ✅ ЗАКРЫТ @ 1d03b2c (CI SUCCESS, облако)
Терм. claude на feat/m4-workspace-runtime: SQLite (node:sqlite DatabaseSync) workspace store (clients/projects/campaigns/content/assets/render+publish jobs/notes/activity-log), API-роуты /api/product?route=workspace/*, миграции 0001, JSON import/export. ПО ХОДУ НАЙДЕН+ИСПРАВЛЕН реальный баг: in-memory БД теряла записи между запросами → persist на диск (1d03b2c). Полный CI-гейт в облаке (467 unit + 6 media реальный ffmpeg + publish + workspace-integration + build + smoke), EXIT 0. Ноут холодный — весь тяжёлый гейт ушёл на серверы GitHub (публичный репо = безлимит минут). Vercel deploy тоже SUCCESS.

## Gate M6 (open-source legal/governance) ✅ ЗАКРЫТ @ 3e75d93 (merge) + 52e8f1e (license)
Терм. claude на feat/m6-opensource-docs (31956bd): community-файлы (CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/SUPPORT/GOVERNANCE/ROADMAP/CHANGELOG), issue/PR-шаблоны, THIRD_PARTY_NOTICES + docs/licenses.json (реальные депы pg 8.22.0 + vite 7.0.0, все пермиссивные MIT/ISC/BSD-3/CC0), README на EN с ЧЕСТНОЙ feature-matrix (VERIFIED/PARTIAL/PLANNED — auto-publish честно PARTIAL), CI-badge. LICENSE_DECISION: AGPL-3.0-or-later (рекоменд.) vs Apache-2.0. Ревьюил: фейк-успеха нет, LICENSE НЕ был закоммичен (ждал владельца).
РЕШЕНИЕ ВЛАДЕЛЬЦА (Вадим, 2026-07-24): **AGPL-3.0-or-later** — защита клина free/open/BYOK/local/transparent сетевым copyleft (хостинг-форки обязаны открывать улучшения); коммерция (done-for-you, платные SaaS-тарифы) разрешена. Реализовано @ 52e8f1e: каноничный текст LICENSE (sha256 0d96a4ff…, 661 строк), package.json "license", README License-секция+badge, LICENSE_DECISION → DECIDED. `validate: ok`. CI прогоняет полный гейт с лицензией.
РЕГЛАМЕНТ: ~/Загрузки/HERMES_BOARD_OPEN_SOURCE_COMPLETION_MASTER_PROMPT.md (12 фаз 0–11 → бесплатный open-source RC). Без субагентов/workflow; терминальный claude = backend-полоса; я = оркестрация + frontend-полоса + review/merge/gate. Без публичного push до разрешения Вадима.

PHASE 1 (M1-ext аналитика) ✅ ЗАКРЫТ @ d5e7f2a: обе полосы слиты (backend af46c4e полный контракт deriveRenderAnalytics, frontend 04442d2 расширенный блок). Полный gate с реальным ffmpeg: 345 unit/0 + 5 media/0 + build + smoke, EXIT 0. Детали — docs/milestones/M1_ANALYTICS.md.

PHASE 2 backend ✅ СЛИТ в main @ 601a646 (merge) + ac064ef (fix node_modules) + 741a429 (lockfile): broll-providers.js (унифицированный контракт kind/costClass/health/timeout/retry/cancel/provenance + registry), fail-open каскад в render-project (generative-image→stock→deterministic, каждая сцена получает provenance+assetType), video-validation.js (MP4 magic-byte), manifest.footage[].assetType, VALID_BROLL_MODES=auto/free/premium/deterministic. Ревьюил: границы чисты (frontend не тронут), fail-open не роняет рендер, deterministic-fallback всем сценам. Полный gate: 382 unit/0 + 6 media/0 (вкл. НОВЫЙ реальный smoke «deterministic mode MP4 without external API calls» — бесплатный путь PHASE 2) + build + smoke, EXIT 0. Грабля: merge затёр реальный node_modules циркулярным symlink → npm install восстановил (backend-worktree deps = symlink на main).
PHASE 2 ✅ GATE M2 ЗАКРЫТ @ f59f367 (docs/milestones/M2_BROLL.md). Frontend-полоса: терм. claude умер на обрыве интернета (ENOTIMP) → Claude Fable 5 доделал соло (селектор B-roll mode + brief-проводка + UI-тест, merge f87f3c5). Hermetic-фикс гейта: env HERMEST_BROLL_MODE форсит офлайн (bdf56a7) — продуктовый дефолт auto/Pollinations сохранён. Полный gate: 383 unit/0 + 6 media/0 (реальный ffmpeg, вкл. офлайн-smoke) + build + smoke, EXIT 0. Честный гэп: analytics без per-scene assetType-разбивки (backend-follow-up).

PHASE 3 ✅ GATE M3 ЗАКРЫТ @ 00e83f8 (docs/milestones/M3_PUBLISHING.md). Backend (терм. claude, merge ea4608d): publish-contract (draft-default, buildReceipt, sanitizeError-redaction), webhook-адаптер (idempotency/retry-safe/429/cancel), platform-status (webhook available; YouTube/TikTok/Instagram needs_oauth_app — честно), api-wiring. Review-фикс (Fable 5, e9d6834): confirm-гейт для live (req5 не выполнялся — терм. claude ложно заявил closed; закрыт fail-closed + негативный тест, enforced на адаптере). publish-smoke вписан в gate навсегда (00e83f8). Авторитетный полный gate: 451 unit/0 + 6 media/0 + 1 publish-smoke/0 + build + smoke, EXIT 0. Честный гэп: реальные соц-адаптеры требуют OAuth-приложений (регистрация Вадимом) + platform review — помечено needs_oauth_app.

PHASE 4 PARTIAL / ПАУЗА (термо): терминальный claude на feat/m4-workspace-runtime закоммитил 544d6fd (SQLite node:sqlite workspace store: clients/projects/campaigns/content/assets/render+publish jobs/notes) + 34e33fc (workspace API routes /api/product?route=workspace/*), дерево чистое — код НЕ потерян. Прерван на финальном гейте из-за перегрева ноута (90→98°C): виновник — git-status polling Claude Desktop по всему /home (гигантский git-репо, respawn мгновенный, durable-фикс Вадим не выбрал) + мои ffmpeg/piper-гейты одновременно. Убил ветку → 77°C.
ТЕРМО-ПРОТОКОЛ (реш. Вадима «притормозить темп»): НЕ запускать терминальный claude gate и оркестраторский gate одновременно; ≤1 тяжёлого ffmpeg-гейта за раз; проверять `sensors` до и ждать охлаждения; не долбить коммитами подряд (триггерит desktop-скан).
NEXT (когда остынет): ревью 2 коммитов M4 (verify no fake-success) → доделать недостающее (миграции-тест, JSON import/export, permission-тесты — проверить, вошли ли) → ОДИН паузный gate → merge → Gate M4 → frontend workspace UI → PHASE 5.

## Конкурент InMedia (Инмедиа, Баку / Silkway Accelerator / Astana Hub) — бенчмарк
Из расшифровки TikTok-ролика (@astana_hub): единая AI-платформа — генерация текста/картинок/видео/озвучки + публикация + аналитика + CRM; «вместо десятков сервисов — одна экосистема». VC: $85k инвестиций, $150k Azure, $25k Cloudflare, раунд $250k.
НАШ КЛИН: полностью бесплатно + BYOK + локально + приватно + РЕАЛЬНЫЙ детерминированный MP4 — того, что VC-SaaS позволить не может. Наши разрывы: аналитика (закрыт M1), авто-публикация (OAuth), генеративные видео-клипы, CRM (не приоритет). Сравнение — в ответе сессии 2026-07-23.

## Milestone M1 «аналитика ролика» 2026-07-23 — ✅ ЗАКРЫТ (main @ 101013c) — ответ на InMedia
Контракт: docs/ANALYTICS_MILESTONE_HANDOFF.md. Ветки feat/analytics-ux (я) + feat/analytics-runtime (терм. claude).
- ПОЛОСА A (я): блок «Аналитика ролика» на completed-рендере — длительность/LUFS/размер MP4/сцены/голос+язык/формат/музыка/
  число артефактов/SHA-256 + кнопка «Скопировать сводку». Скрыт без analytics, безопасный DOM, a11y-section, мобайл 375px. +1 UI-тест.
- ПОЛОСА B (терм. claude соло, 83c2349): аддитивное job.analytics ТОЛЬКО на completed, деривация из verified result.manifest
  (durationSeconds/LUFS/voice/language/recipeId/sceneCount/musicUsed/artifactCount/totalBytes/videoBytes/videoSha256),
  try/catch (сводка не роняет рендер), санитизация (пути→<path>, ≤80, sha256 /^[a-f0-9]{64}$/), null/0 без выдумки,
  cancel×late → не публикуется. +6 unit. Только job-manager, src/media НЕ тронут.
- ИНТЕГРАЦИЯ: merge → main 101013c. Дифф ревьюил (deriveRenderAnalytics best-effort, имена полей 1:1 с фронтом). Лёгкий gate:
  validate ok · 340 unit (0 fail) · smoke:api ok · build ok. Живой smoke: блок рендерится (9 полей, copy), скрыт без analytics,
  мобайл без переполнений, консоль чистая. Терм. claude exit 0. Push НЕ делал.
NEXT: M2 генеративный AI-b-roll (ближе к «генерации видео»); ИЛИ M3 авто-публикация (OAuth, нужно решение Вадима по площадкам/ключам).

## Milestone «resume in-flight задач после reload» 2026-07-23 — ✅ ЗАКРЫТ (main @ 88cad83)
Контракт: docs/RESUME_MILESTONE_HANDOFF.md. Ветки feat/resume-ux (я) + feat/resume-runtime (терм. claude).
- ПОЛОСА A (я): персист id активных draft/render в localStorage (ключ hermest-board:active-jobs:v1) при submit, очистка на терминале;
  на загрузке resumeActiveJobs → GET по id: running/queued → восстановить busy-UI (кнопка отмены, elapsed от createdAt) + re-poll;
  терминальный/404/evicted → тихо очистить (НЕ авто-применять — юзер мог менять доску). Рефактор submit-путей: общие settleDraftJob/
  settleRenderJob/draftErrorText/renderErrorText для запуска и reconnect (DRY). +2 UI-теста. Коммит в merge.
- ПОЛОСА B (терм. claude соло, 8e948f6+ba0c0f2): НАЙДЕН+ИСПРАВЛЕН реальный баг — draft-TTL считался от createdAt → завершённый
  long-draft вычищался следующим submit'ом, reconnect терял результат; теперь markFinished фиксирует finishedAt, eviction = finishedAt+ttl
  (терминал+TTL). Активные job уже были защищены (закреплено тестом). createdAt уже отдавался обоими publicJob. +9 unit. Только backend.
- ИНТЕГРАЦИЯ: merge → main 88cad83. Дифф ревьюил фактически (markFinished корректен, late-result сохранён). src/media НЕ тронут →
  лёгкий gate: validate ok · 333 unit (0 fail) · smoke:api ok · build ok. Живой smoke: персист при run/очистка на завершении;
  boot-reconnect фейковых id → 404 → очистка без залипания UI; консоль чистая. Терм. claude завершился штатно (exit 0). Push НЕ делал.
  ОГРАНИЧЕНИЕ: running-restore-через-reload не прогнан E2E (мок не переживает reload); проверены персист, boot-wiring, 404-очистка,
  а сам restore переиспользует протестированные settle*-пути + unit-греп на проводку.
NEXT MILESTONE (кандидат, gap-аудит): визуальный прогресс-бар поверх текстового прогресса (job.progress даёт sceneIndex/sceneTotal →
  можно полосу %); ИЛИ защита доски перед draft-перезаписью (applyProjectDocument затирает борд — снапшот/undo). Один bounded.

## Milestone «прогресс-фидбэк длинной генерации» 2026-07-23 — ✅ ЗАКРЫТ (main @ 34c8421)
Контракт: docs/PROGRESS_MILESTONE_HANDOFF.md. Ветки feat/progress-ux (я) + feat/progress-runtime (терм. claude).
- ПОЛОСА A (я): elapsed-таймер (mm:ss) + пульс-индикатор активности для draft и render (aria-hidden — не спамит SR;
  prefers-reduced-motion honored); показ этапа рендера от worker (job.progress.label, напр. «Сцена 3 из 6») в заголовке
  статуса; таймеры чистятся на любом терминальном статусе. +1 UI-тест. Коммит в merge 34c8421.
- ПОЛОСА B (терм. claude соло, 185d68b): поле job.progress {phase,sceneIndex,sceneTotal,label} аддитивно; reporter
  инъектируется в renderProject (best-effort, try/catch — не роняет рендер); done только менеджером (cancelled/failed не
  покажут ложный done); late-зомби-отчёты игнорируются; label санитизирован (пути→<path>, ≤120). +11 unit. Тронут
  src/media/render-project.js → потребовал полного media-gate.
- ИНТЕГРАЦИЯ: merge → main 34c8421. Дифф ревьюил фактически (reporter best-effort подтверждён). ПОЛНЫЙ npm run check
  (src/media менялся) → exit 0: validate · 323 unit · smoke:api · 5 media (реальный FFmpeg жив с репортером) · build · render smoke.
  Живой smoke: elapsed тикает и скрывается, progress.label показан, интервалы без утечек, консоль чистая. Push НЕ делал.
  Терм. claude в этот раз завершился штатно (exit 0) — единый harness-background механизм.
NEXT MILESTONE (кандидат, gap-аудит): durable-восстановление незавершённого черновика/настроек между перезагрузками
  (сейчас доска persist в localStorage, но in-flight draft/render теряются); ИЛИ прогресс-бар (визуальная полоса) поверх
  текстового прогресса. Один bounded.

## Milestone «паритет отмены рендер-джобы MP4» 2026-07-22 — ✅ ЗАКРЫТ (main @ 7afda71)
Контракт: docs/RENDER_CANCEL_MILESTONE_HANDOFF.md. Ветки feat/render-cancel-ux (я) + feat/render-cancel-runtime (терм. claude).
- ПОЛОСА A (я): live-region статуса рендера (role=status aria-live=polite) + aria-label кнопки; понятные пользователю сообщения
  по статусу (в очереди/идёт/отменён/ошибка/готово) вместо dev-дампа; retryable ошибка отмены (кнопка не залипает); структурные
  404/409; гард двойной отмены. Обновил тест local-media-ui под новые строки. Коммиты 8860de6, a55c533.
- ПОЛОСА B (терм. claude соло, 9b17f4a): render cancel → {outcome} (идемпотентно/404/409/202); РЕАЛЬНОЕ убийство child-процессов
  (controller.abort → runMediaTool child.kill SIGTERM→SIGKILL; process-runner уже honor'ил signal); late-result отбрасывается
  (isCancelled не даёт стать completed, discardRenderOutput). +13 unit (298→311). ТОЛЬКО backend-файлы.
  ГРАБЛЯ: терм. claude упал по транзитной API-ошибке ПОСЛЕ коммита (на финальном отчёте) — код+тесты уцелели (311 зелёных);
  НЕ перезапускал зря, догнал гейт сам как интегратор. Дифф ревьюил фактически.
- ИНТЕГРАЦИЯ: merge 6699f28 (backend→ux), merge 7afda71 (→main). Поймал регрессию: UI-тест грепал старую dev-строку статуса →
  обновил тест (a55c533). Лёгкий gate на main: validate ok · 311 unit (0 fail) · smoke:api ok · build ok. src/media не тронут →
  тяжёлый media-gate не гонялся. Живой smoke: консоль чистая (только Vite HMR-ws шум), cancel/aria-live/worker готовы. Push НЕ делал.
NEXT MILESTONE (кандидат, gap-аудит перед стартом): прогресс-фидбек длинной сборки draft/render (elapsed/шаги/спиннер) —
  сейчас только текстовый статус без ощущения прогресса; ИЛИ durable-состояние черновика между перезагрузками. Один bounded.

## Milestone «управляемая отмена draft-job» 2026-07-22 — ✅ ЗАКРЫТ
Контракт: docs/CANCEL_MILESTONE_HANDOFF.md. Две изолированные ветки, disjoint files, я мержил.
- RC закрыт в main: merge 0ef4d86 (integrator/ux-release-candidate → main).
- ПОЛОСА A (я, feat/draft-cancel-ux): кнопка «Отменить» в queued/running; состояния запуск/выполняется/отменяется/
  отменено/ошибка-отмены/успех; гарды двойного submit и cancel; backend-authoritative (poll видит cancelled, без гонки);
  a11y (aria-live status, aria-label, keyboard, фокус на теме после отмены); мобайл 375px. Коммиты 0c9ecb8, 44d285e.
  НАЙДЕН+ИСПРАВЛЕН реальный интеграционный баг: worker требует content-type: application/json на local-маршрутах →
  DELETE отмены без заголовка давал 415, отмена не работала против реального backend (мок не поймал). Фикс 44d285e.
- ПОЛОСА B (терминальный claude соло, feat/draft-cancel-runtime): idempotent cancel {outcome}, late-result discard,
  404 not_found / 409 not_cancellable / 202 cancelled, очистка таймеров/abort. +10 unit (288→298). Коммиты 18b8815, e7c2bc6.
- ИНТЕГРАЦИЯ: merge 6ec36e8 (backend→ux), merge acf3ff3 (feat/draft-cancel-ux → main). main @ acf3ff3.
  Дифф ревьюился фактически (не только отчёт). src/media НЕ тронут → тяжёлый media-gate не гонялся повторно.
  Лёгкий gate на main: validate ok · 298 unit (0 fail) · smoke:api ok · build ok — все exit 0. Живой smoke: консоль чистая,
  CTA/cancel/aria-live/BYOK/21 карточка. Процессы: единый harness-background (без nohup+&, без self-matching poller). Push НЕ делал.

## Параллельные полосы 2026-07-22 (директива Вадима: использовать И терминального claude)
Контракт границ: docs/INTEGRATION_HANDOFF.md. Правило: локальные LLM (Ollama) не запускать; push запрещён (переопределяет standing-approval).
- ПОЛОСА A (я, ветка integrator/ux-release-candidate): frontend/product UX.
  ✅ Онбординг + заметный вход в главный сценарий. Коммиты 1cfa6bb (handoff), cc996f6 (UX).
     Новый пользователь: первый-запуск оверлей «Из темы — в готовое видео» (тема→сразу в wizard) + шапка-CTA «🎬 Тема→видео»
     (открывает панель, префилл+фокус wizard). localStorage-gated. Проверено вживую в превью: оверлей show/dismiss/persist,
     CTA открывает+префиллит+фокусит, мобайл 375px без переполнений, validate ok, консоль чистая. Скриншот-рендерер превью
     таймаутит (проблема инструмента, не приложения).
- ПОЛОСА B (терминальный claude, worktree ../hermest-board-backend, ветка feat/backend-runtime): backend/runtime robustness. ✅ ЗАВЕРШЕНО.
     4 коммита (bc1b894 error-envelope, 8d359bc input-validation 400, 7ebf23a fail-closed мост+стрим, 871342f sanitize warnings),
     +16 unit (272→288), только backend-файлы. Закрыл крашер: createReadStream().pipe() без error-handler ронял весь vite dev-server.
- ✅ ИНТЕГРАЦИЯ (я): merge a50f42d (feat/backend-runtime → integrator/ux-release-candidate, disjoint files, 0 конфликтов).
     Фронт-контракт цел: fetchJson читает data.error (строка), code лёг в error.payload аддитивно.
     ПОЛНЫЙ ГЕЙТ `npm run check` → exit 0: validate · 288 unit · smoke:api · 5 media (реальный FFmpeg) · build · render smoke.
     Живой интеграционный smoke: консоль чистая, CTA/онбординг/BYOK(10 опц.)/render-worker готовы, 21 карточка. Push НЕ делал (директива).
     Worktree ../hermest-board-backend оставлен для следующей backend-порции терминального claude.
ACTIVE TASK: очередь Вадима 2026-07-21 (браузерные модели удобно в UI) — ВСЕ ТРИ ПУНКТА закрыты/проверены за сессию:
  ПУНКТ 1 wizard «тема→видео»: c9ac973 → a767be9 (async job, UI не виснет; submit 38мс, cancel→cancelled вживую).
  ПУНКТ 2 выбор ИИ-модели: 124b637 (селект из /bridge, 4 провайдера live, дефолт deepseek; model санитизирован allowlist + проброшен topic→draft→text-model). Гейт 261/261 unit + 5/5 media.
  ПУНКТ 3 BYOK медиа-ключи: УЖЕ РАБОТАЕТ (provider-keys пишет в process.env, медиа-адаптеры FAL/Pexels/ElevenLabs читают оттуда в том же worker-процессе). Проверено вживую: POST /providers/fal/key → source "session" → рендер использует. UI-панель byokProviders (set/clear) существует.
Весь бэкенд писал терминальный claude (opus, соло, --disallowed-tools Task), я ревьюил и интегрировал UI/проверял.
STATUS: IN_PROGRESS
LAST COMMIT: 124b637 выбор модели в wizard. До: a767be9 async draft, c9ac973 wizard.
ПРОДОЛЖЕНИЕ 2026-07-21 (та же сессия):
  SW ГРАБЛЯ ИСПРАВЛЕНА: fdd7437 (network-first для HTML) → 0c63ae5 (cache-first ТОЛЬКО для /assets/, всё прочее network-first; версия v3). Причина: cache-first на всё кэшировал и index.html, и dev-модули /src/app.js. Проверено вживую: свежий UI отдаётся через SW, старый кэш удаляется.
  UX-2 текстовый BYOK ЗАКРЫТ: 8c86be3. Wizard может драфтить через ЛЮБОЙ OpenAI-совместимый API — пресеты (OpenRouter/Groq/Together/DeepSeek-API/Mistral/HuggingFace/OpenAI/Ollama) или свой URL + ключ. src/media/openai-text-model.js (SSRF-guard: удалённый только https, http лишь localhost; ключ не в логах/ошибках; header-injection guard; bounded). draft-service выбирает bridge vs openai; для openai мост НЕ нужен. ЖИВОЙ E2E через локальный Ollama (kimi-k2.7-code:cloud): реальный борд «Зачем нужен сон» 3 карточки за ~6с, БЕЗ моста, БЕЗ ключа — и в разы быстрее reasoning-моста. Гейт 269/269 unit + 5/5 media. Ключ безопасен: draft-job держит params только в замыкании.
ПРОДОЛЖЕНИЕ 2026-07-22 (ночь, автономно; лимиты обновлены):
  РЕШЕНИЕ Вадима: развилка → UX-2-медиа (BYOK/бесплатная генерация картинок/звука). Правила те же: терминальный claude (Opus 4.8 ultracode, соло, --disallowed-tools Task) + Ollama/OpenCode; я — без субагентов/workflow.
  ГРАБЛЯ HuggingFace image: HF УБРАЛ бесплатную serverless-генерацию картинок — api-inference.huggingface.co МЁРТВ (http 000), router hf-inference → 410/«model deprecated/not supported», через платных провайдеров → 402 (нужны кредиты). Адаптер делегата бил в мёртвый эндпоинт → ОТКАЧЕН (никогда не коммитился). HF ценен ТОЛЬКО как текстовый провайдер (router.huggingface.co/v1/chat жив, 200 — уже в text-BYOK пресетах).
  РАЗВОРОТ: настоящий бесплатный image-API БЕЗ КЛЮЧА — Pollinations (image.pollinations.ai/prompt/<enc>?width&height&seed&nologo&model=flux). Проверено вживую: реальный JPEG 1024×576, релевантный промпту. Адаптер пишется (делегат), встраивается в каскад FAL→Pollinations(всегда)→Pexels; availability станет ВСЕГДА executable (генерация без ключей).
  Piper HOME-фикс (os.userInfo().homedir вместо os.homedir(), устойчивость к agent-scoped HOME) — отдельный коммит 53c17f7 (был scope-creep делегата, вынесен чисто).
  UX-2-МЕДИА (картинки) ЗАКРЫТ и проверен вживую:
    - cea5135: Pollinations-адаптер (бесплатно, без ключа) в каскаде FAL→Pollinations(всегда)→Pexels; генерация opt-in (brief.generateVisuals ИЛИ платный ключ), по умолчанию выкл → рендеры детерминированы и без сети (гейт не флакает). hasKeyedImageProvider() — новый экспорт.
    - 411344c: UI-тумблер «Генерировать фоны (бесплатно, Pollinations)» в панели рендера → brief.generateVisuals, persist. Проверено в превью.
    - ЖИВОЙ keyless-рендер: борд с generateVisuals:true → 2 сцены получили Pollinations-фоны (manifest footage provider=pollinations), MP4 1920×1080, кадр визуально подтверждён (горное озеро по промпту). Сэмпл Вадиму: ~/Видео/hermest-board-voice-samples/pollinations-free-visuals-1080p.mp4.
  ИТОГ медиа-BYOK: ТЕКСТ (директор) — любой OpenAI-совместимый (Ollama/OpenRouter/HF/… или свой ключ); КАРТИНКИ — Pollinations бесплатно + FAL BYOK; ГОЛОС — Piper бесплатно (отвергнут) + ElevenLabs BYOK (ключ есть); МУЗЫКА — процедурная бесплатно. Все медиатипы имеют бесплатный И BYOK путь.
ЦЕЛЬ Вадима 2026-07-22: довести до release-ready продукта (11 критериев). Правило усилено: ВЕСЬ код/доки пишет терминальный claude (Opus soло, --disallowed-tools Task), я — оркестратор/ревью/проверка.
  АУДИТ: гейт зелёный (272 unit + 5 media + build + smoke); дерево чистое; продукт функционален и проверен вживую. Гэпы были: README устарел, engines не задан, Docker без .dockerignore, release-пакет отсутствовал.
  Этап A (7cb5501): README актуализирован под все фичи + engines.node. Этап C (9b153d1): .dockerignore + Dockerfile npm ci; Docker-образ СОБРАН и проверен (HTTP 200, отдаёт SPA) — критерий 5. Демо полного стека (Ollama→ElevenLabs George→Pexels→анимация, 64с, loudness −16.5) в ~/Видео/hermest-board-voice-samples/full-stack-demo-ocean-george-1080p.mp4.
  Этап E (в работе, делегат): scripts/build-release.mjs + SHA-256 manifest dist + docs/RELEASE_STATUS.md + HANDOFF/RELEASE_READINESS синк — критерии 10/11.
  RELEASE v0.3.0 ВЫПУЩЕН (тег v0.3.0, запушен). Все 11 критериев Вадима выполнены фактически (не заявлением):
    установка/запуск по докам ✓ · UI без критич.ошибок ✓ · запросы к AI (wizard→Ollama live E2E, мост 4 провайдера) ✓ ·
    состояние/восстановление ✓ · Docker собран+отдаёт SPA HTTP200 ✓ · сценарии вручную+тесты (272 unit+5 media) ✓ ·
    нет секретов в коде/мёртвого веса (source-zip обновлён) ✓ · fail-open провайдеров ✓ · чистый модульный код ✓ ·
    docs актуальны (README/RELEASE_STATUS/handoff/CHANGELOG@0.3.0) ✓ · release package + SHA-256 manifest (build-release.mjs) ✓.
    Артефакт релиза: dist/RELEASE_MANIFEST.sha256 (version 0.3.0, детерминированный). Статус-отчёт: docs/RELEASE_STATUS.md.
    ВСЁ писал терминальный claude (Opus соло, --disallowed-tools Task); я — оркестратор/ревью/живые проверки. Fable не трогал.
STATUS: RELEASE_READY (v0.3.0)
LAST COMMIT: 4461d30 release 0.3.0 + тег v0.3.0. Осн. release-коммиты: 7cb5501 README, 9b153d1 Docker, c451989 release-tooling, b417389 source-zip.
NEXT ACTION (после релиза, требует решений Вадима): UX-3 оболочка/Google-логин на Supabase (creds Вадима); либо продуктовый хвост P3+ (semantic shorts, editions, шаблоны). Мост :8788; Ollama :11434.
NEXT ACTION: варианты (Вадим спит, автономно): (1) полный free-stack E2E демо-ролик (Ollama-директор → Pollinations-фоны → ElevenLabs George → премиум-анимация) как showcase + интеграционное доказательство; (2) UX-3 оболочка (заставка/меню/Google-логин/Supabase) — ЗАБЛОКИРОВАНО: нужны Supabase creds Вадима (URL+anon+service key), без них не начинать. HF-image мёртв (не возрождать). Мост :8788; Ollama :11434 (модель kimi-k2.7-code:cloud).
NEXT ACTION (развилка, спросил Вадима): (A) UX-2-медиа — BYOK-коннекторы генерации ИЗОБРАЖЕНИЙ/ЗВУКА (HuggingFace/Replicate для картинок, доп. TTS) по образцу openai-text-model, + произвольный коннектор через UI; ИЛИ (B) UX-3 оболочка — заставка/меню/Google-регистрация/мультиустройство на Supabase (аккаунт ЕСТЬ у Вадима) = P5 SaaS-ядро, самый крупный кусок. Текстовый director-BYOK — самый частый провайдер, уже даёт максимум рычага, поэтому сделан первым.
ГРАБЛИ WIZARD/МОСТ: (1) РЕШЕНО async: reasoning-чаты думают МИНУТАМИ — теперь job, UI не висит. НО deepseek draft реально >5 мин (DeepThink) → нужен выбор быстрой модели (UX-1) ИЛИ BYOK-ключ (UX-2). (2) Дефолт модели в text-model.js = "chatgpt" (флаки); рабочая — deepseek. preview-харнесс НЕ подхватывает env из launch.json (для реального npm run dev — env вручную ИЛИ передавать model из UI после UX-1). (3) Мост залипает (провайдер держит lock) — рестарт: `pkill -f bridge-server; cd ~/ai-dev-station/workspace/browser-ai-bridge && setsid nohup node src/bridge-server.mjs >> bridge-server.log 2>&1 < /dev/null &`. Мост :8788, 4 провайдера.
UNCOMMITTED: none
NOTES: (а) бесплатный timeline-аудит (deepseek): на fps=30 дрейф кадров 16 сцен ≈1мс — безопасно; НО fps=24-рецепт дал бы ~276мс рассинхрона — при добавлении 24fps-рецепта обязателен guard-тест; (б) бесплатный docs-аудит (nemotron): в docs/RELEASE_READINESS.md накопился дрейф эпохи R1-R2 (строки ~16-18, 55-56, 68 vs 93) — кандидат на чистку бесплатным агентом под присмотром, не приоритет
BLOCKERS: (1) Вадим слушает ru-fullstack-{aterna,george}.mp4 и выбирает release-голос (Piper отвергнут ранее — сэмплы ТОЛЬКО ElevenLabs); (2) FAL live-smoke: аккаунт fal.ai ЗАБЛОКИРОВАН — «Exhausted balance», пополнить на fal.ai/dashboard/billing (~$5) — сам ключ валиден (аутентификация проходит), код готов и ждёт; (3) прослушивание музыкальной подложки (процедурный ambient — можно докинуть CC0-треки в assets/music)

## Дорожная карта (кратко; полностью — MASTER_PLAN)

- [ ] **P0** стабилизация: merge → main, push, deploy, тег, handoff-синк
- [ ] **P1** мультиязычный голос (Piper RU/EN/ES/DE/FR + ElevenLabs BYOK «любой язык», reconciliation, loudnorm)
- [ ] **P2** визуалы + звук (FAL BYOK + style-пресеты, стоковый фолбэк без ключей, музыка с auto-ducking, Ken Burns)
- [ ] **P3** AI Director «тема→видео», semantic shorts + karaoke-сабы, мультиязычные editions, шаблоны
- [ ] **P4** dogfood: перегенерировать ролики Дмитрий/Светлана продуктом на RU/EN/DE/ES → открываются done-for-you продажи
- [ ] **P5** SaaS-ядро: auth + Postgres + object storage + durable queue (то, что требует /api/health)
- [ ] **P6** деньги: биллинг (MoR), тарифы $0/$19/$39/$99, метеринг, watermark Free, brand kit, лендинг, concierge-бета
- [ ] **P7** после денег: R6 автопубликация, R7 analytics, серии, API, voice cloning, OTIO-экспорт

## Журнал чекпоинтов (новые сверху)

- 2026-07-19 · Fable 5 · Мастер-план финализирован (мультиязычность, конкурентный анализ, бэклог B1–B11 включён в фазы), скопирован в репо, создан EXECUTION_STATE. Начата P0.

## PHASE 4 ✅ GATE M4 ЗАКРЫТ @ 1d03b2c (CI Gate SUCCESS в облаке)
SQLite (node:sqlite) workspace: clients/projects/campaigns/content/assets/render+publish jobs/notes + миграции + JSON import/export + backup/delete cascade + поиск/фильтры + tenant/permission (single+multi-user, negative-тест cross-user) + activity-log. 467 unit + workspace integration в гейте. Терминальный claude поймал реальный баг (in-memory БД теряла записи) → 1d03b2c persist-on-disk + self-contained тест. Merge ccf2edd, gate wiring 6f73371, fix 1d03b2c. Offload полностью: гейт гоняется в GitHub Actions, ноут холодный.

## PHASE 6 IN_PROGRESS (open-source legal/docs): терминальный claude на feat/m6-opensource-docs. Спека scratchpad/m6-opensource-spec.md: license audit (только pg в проде; assets/music=CC0; голоса/визуалы качаются в runtime, не в репо) + THIRD_PARTY_NOTICES + LICENSE_DECISION (рекоменд. AGPL-3.0, но LICENSE НЕ коммитим — единственное решение Вадима) + community files (README с честной feature-matrix + CI-badge, CONTRIBUTING/CoC/SECURITY/SUPPORT/GOVERNANCE/ROADMAP/CHANGELOG, issue/PR-шаблоны). TEXT-ONLY, ноут холодный. NEXT: ревью → merge → Gate M6 → PHASE 7 (установка/деплой) → 8 (security) → 10 (доки) → 11 (RC).
