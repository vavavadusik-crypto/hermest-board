# Roadmap

This roadmap outlines the planned development phases for Hermest Board, derived from the internal master plan (internal engineering plan). Statuses are **honest** — DONE means verified and merged, IN PROGRESS means active work, PLANNED means designed but not started.

See [CHANGELOG.md](CHANGELOG.md) for past releases and detailed change history.

---

## Current Focus

**Phase:** P0 (Stabilization) → M6 (Open-Source Preparation)  
**Active work:** Documentation, community files, license decision  
**Next milestone:** Public open-source release

---

## Phases Overview

| Phase | Name | Status | Description |
|-------|------|--------|-------------|
| **M1** | Analytics | ✅ DONE | Render analytics block (duration/LUFS/size/scenes/voice/format/SHA-256) |
| **M2** | B-Roll Pipeline | ✅ DONE | Free visual generation (Pollinations), premium (FAL BYOK), deterministic fallback, honest fail-open cascade |
| **M3** | Publishing Contract | ✅ DONE | Publish webhook skeleton, platform status (YouTube/TikTok/Instagram needs OAuth apps), draft-default, idempotency, sanitized errors |
| **M4** | Workspace Storage | ✅ DONE | SQLite node:sqlite persistence (clients/projects/campaigns/content/assets/jobs/notes), tenant isolation, backup/delete |
| **M5** | Codespaces & CI | ✅ DONE | GitHub Codespaces devcontainer (zero laptop load), CI Gate (451 unit + 6 media real FFmpeg + build + smoke, all exit 0) |
| **M6** | Open-Source Prep | 🔄 IN PROGRESS | DOCS/LEGAL lane: community files (CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/SUPPORT/GOVERNANCE/ROADMAP/CHANGELOG), license audit, THIRD_PARTY_NOTICES, LICENSE_DECISION, issue/PR templates, README feature matrix with honest statuses |
| **P1** | Multilingual Voice | ⏳ PLANNED | Piper (local, free, RU/EN/ES/DE/FR) + ElevenLabs BYOK (29+ languages, "any language" mode), language as project parameter, timeline reconciliation, loudness normalization |
| **P2** | Visuals + Sound | ⏳ PLANNED | FAL BYOK image generation + style presets (visual consistency), asset cache, rights/provenance gate, image QC, Ken Burns motion in FFmpeg, UI scene visual preview, music with auto-ducking, free stock fallback (Openverse/Pexels/Wikimedia Commons) |
| **P3** | Topic → Video Automation | ⏳ PLANNED | AI Director (production brief + clarifying questions with defaults), research → source cards, fact/claim lineage + contradictions, structured contracts (outline → script → storyboard, provider-neutral JSON schemas, strict validation), step-by-step wizard UI, semantic shorts v1 + karaoke subtitles, multilingual editions (one project → same scenes in N languages), format templates (explainer/news digest/promo/tutorial/faceless-series) |
| **P4** | Dogfood Marketing | ⏳ PLANNED | Regenerate demo videos (Dmitry/Svetlana) entirely via pipeline (no screen recordings), side-by-side comparison (old vs generated), 2-3 real-topic demos + RU/EN/DE/ES editions for ATERNA channels → opens done-for-you sales |
| **P5** | SaaS Core | ⏳ PLANNED | Auth + workspaces, Postgres-JSONB storage (activate guarded path), object storage (private upload/signed download), durable queue + worker leases (pg-boss), encrypted connector token storage, rate limits + quotas skeleton, Vercel Pro (commercial use) |
| **P6** | Monetization | ⏳ PLANNED | Billing (Merchant of Record: Paddle or Lemon Squeezy), tiers ($0/$19/$39/$99), metering (UsageRecord), quotas + alerts, billing integration (checkout/webhooks/upgrade/downgrade), landing page + waitlist (RU+EN), Terms/Privacy/Support, concierge private beta (5-10 manual clients), Free-tier watermark (viral loop), brand kit (logo/colors/fonts/intro-outro for workspace) |
| **P7** | Post-Revenue | ⏳ PLANNED | Auto-publish to social platforms (OAuth exchange/refresh/revoke, platform review, reconciliation), analytics loop (insight cards, 1.0), content series/calendar (what AutoShorts sells for $19-69), Public API + n8n/Zapier (agencies/automators), voice cloning (ElevenLabs, consent gate), timeline export (JSON/OTIO to DaVinci/Premiere) |

---

## Detailed Phase Breakdown

### ✅ M1 — Analytics (DONE)

**Goal:** Render analytics block — duration/LUFS/size/scenes/voice/format/artifacts/SHA-256.

**Status:** ✅ Merged to `main` @ 101013c (2026-07-23)

**Deliverables:**
- Analytics block on completed renders (duration/LUFS/size MP4/scenes/voice+language/format/music/artifact count/SHA-256).
- "Copy summary" button.
- Hidden without analytics, mobile 375px, a11y-section.
- +6 unit tests, additive `job.analytics` only on completed (derived from verified result.manifest).

---

### ✅ M2 — B-Roll Pipeline (DONE)

**Goal:** Free visual generation + premium BYOK + deterministic fallback, honest fail-open cascade.

**Status:** ✅ Merged to `main` @ 741a429 (2026-07-23)

**Deliverables:**
- `broll-providers.js` unified contract (kind/costClass/health/timeout/retry/cancel/provenance + registry).
- Fail-open cascade in render: generative-image → stock → deterministic, every scene gets provenance+assetType.
- `video-validation.js` (MP4 magic-byte check).
- `manifest.footage[].assetType`.
- VALID_BROLL_MODES: auto/free/premium/deterministic.
- ENV var `HERMEST_BROLL_MODE` forces offline mode (product default: auto/Pollinations).
- +6 media tests (including new real smoke "deterministic mode MP4 without external API calls").

**Honest gap:** Analytics block lacks per-scene assetType breakdown (backend follow-up).

---

### ✅ M3 — Publishing Contract (DONE)

**Goal:** Publish webhook skeleton, platform status, draft-default, idempotency, sanitized errors.

**Status:** ✅ Merged to `main` @ 00e83f8 (2026-07-23), with review-fix e9d6834 (fail-closed confirm gate).

**Deliverables:**
- `publish-contract.js` (draft-default, buildReceipt, sanitizeError redaction).
- Webhook adapter (idempotency/retry-safe/429/cancel).
- Platform status: webhook available; YouTube/TikTok/Instagram needs_oauth_app (honest).
- API wiring + publish-smoke in gate forever.
- Fail-closed confirm gate (req5): enforced on adapter, negative test.

**Honest gap:** Real social adapters require OAuth apps (registration by owner) + platform review.

---

### ✅ M4 — Workspace Storage (DONE)

**Goal:** SQLite node:sqlite persistence (clients/projects/campaigns/content/assets/jobs/notes), tenant isolation.

**Status:** ✅ Merged to `main` @ 1d03b2c (2026-07-24), with on-disk fix and integration test in quality gate.

**Deliverables:**
- SQLite node:sqlite workspace store (clients/projects/campaigns/content/assets/render+publish jobs/notes).
- Workspace API routes `/api/product?route=workspace/*`.
- Tenant/workspace permission (single-user default, multi-user owner check).
- Backup + delete workspace (scoped export, cascade).
- Tag filter for list endpoints (search/status/tag).
- On-disk database persistence (not in-memory).
- Integration test in quality gate: `test:workspace`.

---

### ✅ M5 — Codespaces & CI (DONE)

**Goal:** GitHub Codespaces devcontainer + CI Gate (full quality gate on GitHub Actions).

**Status:** ✅ Merged to `main` @ a0f96e0 + 87b27b0 (2026-07-24)

**Deliverables:**
- `.devcontainer/devcontainer.json` (Codespaces cloud dev env, zero laptop load).
- GitHub Actions CI workflow `.github/workflows/ci.yml` ("CI Gate").
- Full quality gate: 451 unit + 6 media (real FFmpeg) + build + smoke, all exit 0.
- Public repo = unlimited minutes (offloads heavy builds from local laptop).

---

### 🔄 M6 — Open-Source Preparation (IN PROGRESS)

**Goal:** Legally and organizationally ready for public viewing. NO fake claims, honest statuses only.

**Status:** 🔄 IN PROGRESS (DOCS/LEGAL lane, feat/m6-opensource-docs branch)

**Tasks:**

**6.1 License Audit:**
- ✅ Direct production deps audit (runtime: `pg` only; devDeps: `vite`; node:sqlite built-in).
- ✅ Fonts: DejaVu Sans (system font, not bundled).
- ✅ assets/music/*.m4a: procedurally generated CC0.
- ✅ No third-party media/voices/models committed (fetched at runtime).
- ✅ THIRD_PARTY_NOTICES.md (full dependency tree, honest licenses).
- ✅ docs/licenses.json (machine-readable).
- ✅ LICENSE_DECISION.md (AGPL-3.0-or-later vs Apache-2.0 recommendation, AGPL recommended for "free, open, no proprietary reselling" wedge). **Owner decision required** before committing LICENSE file.

**6.2 Community Files:**
- ✅ README.md (honest feature matrix VERIFIED/PARTIAL/PLANNED, CI badge, quickstart Codespaces + local, architecture summary).
- ✅ CONTRIBUTING.md (quickstart, code style, PR workflow, first-time contributor guide, TDD rules, security rules).
- ✅ CODE_OF_CONDUCT.md (Contributor Covenant 2.1).
- ✅ SECURITY.md (vulnerability reporting, supported versions, security best practices, security features, roadmap).
- ✅ SUPPORT.md (documentation links, troubleshooting common issues, how to ask good questions, community channels).
- ✅ GOVERNANCE.md (project ownership, maintainer responsibilities, decision-making process, roadmap priorities, conflict resolution, trademark/branding rules).
- ✅ ROADMAP.md (this file, derived from MASTER_PLAN phases, honest statuses).
- ⏳ CHANGELOG.md (Keep a Changelog format, summarize what exists).
- ⏳ .github/ISSUE_TEMPLATE/ (bug_report.md, feature_request.md, config.yml).
- ⏳ .github/PULL_REQUEST_TEMPLATE.md.
- ⏳ Dependency-update policy note (where?).
- ⏳ CITATION.cff (optional, if it fits).

**6.3 Branding:**
- Single name "Hermest Board" (a.k.a. Hermest Board in code).
- Honest feature matrix (VERIFIED/PARTIAL/PLANNED) in README.
- CI Gate badge (real, passes).
- No private data in examples.

**Owner decisions required:** License choice (AGPL-3.0-or-later recommended).

---

### ⏳ P1 — Multilingual Voice (PLANNED)

**Goal:** Real voice in project language. Russian first (owner requirement: "normal voice, not robot"), starting matrix RU/EN/ES/DE/FR; "any language" mode via ElevenLabs multilingual (29+ languages). Language is a project parameter, not hardcode.

**Architecture:** TTS port in `src/media/tts.js` is already provider-neutral — add adapters, don't rewrite pipeline.

**Tasks:**
- ADR for TTS providers (Piper = default local/free/CPU, ElevenLabs `eleven_multilingual_v2` = premium BYOK + "any language" mode; flite remains offline smoke).
- Piper adapter + voice catalog by language (RU `ru_RU-irina-medium` / `ru_RU-dmitri-medium`, EN/ES/DE/FR; missing model = honest `MISSING`, not crash).
- ElevenLabs BYOK adapter (key from encrypted vault only, 29+ languages, retry+backoff, usage records, hard budget).
- Timeline reconciliation (measured ffprobe duration of each line → scene durations, SRT timing from real durations).
- Audio normalization (FFmpeg loudnorm, EBU R128, -16 LUFS for social, QC in manifest).
- UI language + voice selector (executable status from connector router, hint for languages outside Piper matrix: "available via ElevenLabs (BYOK)").
- Language fixtures in gate (`test:media` gets RU + EN project fixtures).
- Language matrix in manifest (language/voice/provider of each voiceover fixed in manifest and QC).

**Gate:** Representative Russian project → MP4 16:9 and 9:16 with Russian Piper voiceover; EN fixture renders with `en_US` voice (proof language is parameter, not hardcode); with key, same project via ElevenLabs. Owner listens and confirms "voice is alive" (subjective acceptance required).

---

### ⏳ P2 — Visuals + Sound (PLANNED)

**Goal:** Scenes get generated images with motion and music bed — "generating video, not cards."

**Tasks:**
- ADR for image providers (FAL FLUX schnell/dev = main BYOK; Stability/Replicate = fallback; Wikimedia Commons = free source for factual topics).
- FAL adapter in capability router + style consistency (project style-preset: common style-prompt/seed added to every scene so visuals don't look "from different worlds").
- Asset cache (key = hash(prompt+params+model); repeat render doesn't pay twice).
- Rights/provenance gate (every asset in manifest: source generated/commons/user, model, prompt-hash, license; without provenance = candidate not ready).
- Image QC (dimensions/format/non-empty; broken image = scene fail-closed, not black frame).
- Motion in FFmpeg (zoompan Ken Burns + crossfade between scenes on top of generated images; versioned recipe v2, old recipe remains reproducible).
- UI: scene visual preview grid (grid of scenes with images, "regenerate scene" button).
- Music bed with auto-ducking (local CC0 track library, provenance in manifest; FFmpeg `sidechaincompress` — music auto-ducks under voice; track/mood selection in UI, toggleable).
- Free stock fallback (Openverse/Pexels API + Wikimedia Commons as visual source without keys; license/attribution of each asset in manifest, provenance gate extends to stock).

**Gate:** Same Russian project renders with generated visuals, motion, and music under voice; without a single API key, project renders on stock fallback. Video looks like a video, not slides. Owner watches and confirms.

---

### ⏳ P3 — Topic → Video Automation (PLANNED)

**Goal:** One-button "topic → ready draft video," with manual override at every step.

**Tasks:**
- Production brief + AI Director questions (topic → 3-5 clarifying questions with defaults: audience, duration, tone, language, platforms; can skip — defaults apply).
- Research → source cards (existing public research endpoint → source cards with canonical links, dates, excerpts).
- Fact/claim lineage + contradictions (every script claim references source card; contradictions between sources highlighted; unsupported claims flagged).
- Structured contracts for generation (outline → script → storyboard via provider-neutral JSON schemas, BYOK text models from catalog; strict validation of responses, retry on invalid JSON; no hardcoded product text).
- Step-by-step wizard UI (topic → questions → cards (editable) → script (editable) → storyboard → render; progress/errors/repeat step).
- Semantic shorts v1 + karaoke subtitles (from marked script hook/key-points/CTA, assemble 20-40s vertical version — scene selection by meaning, not time crop; burned-in word-by-word subtitles ASS/libass, karaoke style — TikTok/Shorts standard).
- Multilingual editions (language is edition property, not project: approved script translated via structured contract (BYOK text model) → localized voiceover (language voice from P1 catalog) and SRT → same scenes/visuals/storyboard; translation editable manually; each edition = own manifest with language lineage).
- Format templates (presets "explainer / news digest / promo / tutorial / faceless-series": pre-filled brief, script structure, recipe and style; time to first video <5 minutes).

**Gate:** "Quantum computers in simple words" (or any Vadim topic) → without manual card entry → cited cards → Russian script → generated visuals → MP4 master + short → EN-edition of same project. Full North Star path to approval works locally.

---

### ⏳ P4 — Dogfood Marketing (PLANNED)

**Goal:** Product advertises itself — and it's the acceptance test of P1-P3.

**Tasks:**
- Regenerate "Dmitry" video entirely via pipeline (voice `ru_RU-dmitri` or ElevenLabs, FAL visuals, master + short) — not a single frame of screen recording; manifest confirms generated origin.
- Regenerate "Svetlana" video likewise.
- Side-by-side comparison: old screen recording vs generated — content for social "made by the product itself."
- 2-3 demo videos on real topics + their language editions RU/EN/DE/ES for 8 ATERNA Telegram channels — direct dogfood of multilingual editions (P3.7).

**Gate:** Owner accepts video quality as "can show to clients." **From this moment, done-for-you sales open (Master Plan §7.1).**

---

### ⏳ P5 — SaaS Core (PLANNED)

**Goal:** Close exactly the 4 items `/api/health` calls required for production.

**Tasks:**
- Infrastructure ADR (Recommendation: **Supabase** (auth + Postgres + object storage in one, generous free tier, Neon-class) vs Neon+R2+own auth. Owner decision after spike. Queue: **pg-boss** on same Postgres (no new infrastructure)).
- Auth + workspaces (email/OAuth login, sessions, per-user authorization; reuse existing signed-session/scrypt code).
- Postgres-JSONB project storage (activate guarded Postgres path — `pg` already in package.json, schema draft in `docs/DATABASE_SCHEMA_DRAFT.md`; migrations; JSON export/import remains open).
- Object storage for artifacts (private upload/finalize, signed URLs for download; videos do NOT go through Vercel functions (4.5MB limit)).
- Durable queue + worker leases (pg-boss: outbox, retry, cancel, DLQ; local worker picks up jobs by lease; idempotency).
- Encrypted connector token storage (user BYOK keys in encrypted storage — existing vault code → on durable backend).
- Rate limits + quotas skeleton (per-user/workspace limits on requests and jobs).
- **[OWNER]** Vercel Pro (Hobby forbidden for commercial — before enabling billing).

**Gate:** Two users isolated; jobs durable; `/api/health` shows `durable:true`, `requiredForProduction` empty.

---

### ⏳ P6 — Monetization (PLANNED)

**Goal:** Product accepts payment and limits spend.

**Tasks:**
- Billing ADR (**Merchant of Record: Paddle or Lemon Squeezy** — recommendation: Paddle, MoR removes taxes/jurisdiction burden, Stripe may be unavailable by owner region. Owner decision).
- Tiers (from audit 20_PRODUCT_AND_MONETIZATION_PLAN): Local/Free $0 (local, BYOK, no cloud) · Creator $19/mo · Creator Pro $39/mo · Team $99/workspace · usage packs (render minutes / storage / managed AI). No "unlimited" anything.
- Metering: `UsageRecord` (every billable job: compute seconds, storage, egress, provider usage, retries; cost visible BEFORE launch (estimated units)).
- Quotas + alerts (50/80/100% — notification; 100% — graceful block, not surprise bill; BYOK not billed as managed inference).
- Billing integration (checkout, webhook subscriptions, upgrade/downgrade/cancel, grace period; webhook idempotent).
- Landing page + waitlist (separate marketing page on same Vercel: demo videos from P4, tiers, waitlist; RU+EN).
- Terms / Privacy / Support (MoR templates + GDPR minimum; support channel email/TG).
- Concierge private beta (5-10 clients manually: onboarding personally, payment by invoice/wire BEFORE automatic billing; feedback → backlog).
- Free-tier watermark (subtle badge "Made with Hermest Board" in Free render (viral loop); removed on paid tiers).
- Brand kit (logo/colors/fonts/intro-outro of workspace applied to render recipe).

**Gate (= launch gate of paid Board from audit §13):** durable+auth+restore drill (P5) ✓, billing in sandbox ✓, terms/privacy ✓, ≥3 live paying users ✓.

---

### ⏳ P7 — Post-Revenue (PLANNED, do not start earlier)

**Goal:** Auto-publish to social platforms, analytics loop, content series, Public API.

**Tasks:**
- R6 auto-publish (OAuth token exchange/refresh/revoke, platform review TikTok/YouTube/Instagram, reconciliation, kill switch; until then, sell publish pack via export).
- R7 (analytics loop, insight cards, 1.0).
- **B6** Content series / content calendar (what AutoShorts sells for $19-69).
- **B9** Public API + n8n/Zapier integrations (agencies/automators).
- **B10** Voice cloning (ElevenLabs) with consent gate.
- **B11** Timeline export (JSON/OTIO) to DaVinci/Premiere.

---

## What We Explicitly Do NOT Do (Now or Future)

- **No auto-publish to social platforms** (blocked by platform review + product policy) — until R6 (P7).
- **No stack rewrite** (Vite + vanilla JS stays; framework migration is separate decision after revenue).
- **No in-house GPU render / video models** — only image-gen + FFmpeg motion (Ken Burns/transitions). Text-to-video providers = experiment after P6.
- **No monetization of Hermest Agent** (owner's personal wrapper, out of scope).
- **No "unlimited AI" in any tier**.

---

## How to Help

- **Vote on features:** 👍 reactions on issues help prioritize.
- **Contribute implementations:** PRs for roadmap items are prioritized. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Sponsor development:** Contact owner (vavavadusik@gmail.com) for commercial priorities.
- **Report bugs:** [GitHub Issues](https://github.com/vavavadusik-crypto/hermest-board/issues).
- **Discuss ideas:** [GitHub Discussions](https://github.com/vavavadusik-crypto/hermest-board/discussions) (if enabled).

---

**Roadmap source of truth:** the internal engineering plan (internal engineering plan).  
**Last updated:** 2026-07-24 (M6 open-source preparation).
