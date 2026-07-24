# ADR-002: Image Providers for Scene Visuals

Date: 2026-07-19 · Status: ACCEPTED · Phase: P2 (master plan the internal engineering plan)

## Context

The North Star pipeline requires every storyboard scene to carry a real visual
so the render is "a video, not cards". Two sources exist: generated images
(quality ceiling, needs a paid provider key) and free stock (zero-key
onboarding, licensing obligations). Competitors ship stock-only visuals; our
wedge adds generation with per-project style consistency (master plan B3) and
a provenance/rights trail in the manifest. The host has no GPU, so local
diffusion is out of scope. Architecture constraint mirrors ADR-001: visuals go
through a provider-neutral image port; adapters are registered in the
connector capability router; the pipeline never knows a provider by name.

## Decision

1. **Provider-neutral image port.** `src/media/image-source.js` contract:
   `sceneVisual request → image file (PNG/JPEG) + metadata + sha256 + license`.
   Every adapter returns the same shape; the renderer consumes files only.
2. **FAL.ai — primary BYOK generation adapter.** FLUX `schnell` as default
   (fast/cheap), FLUX `dev` as the quality tier. Key only via injectable
   provider/env (`HERMEST_FAL_API_KEY`), never in manifest/logs/errors. Hard
   per-job image budget before any paid call (UsageRecord prototype, same
   pattern as ElevenLabs character budget).
3. **Stability AI / Replicate — fallback BYOK adapters.** Same port, added
   after FAL is proven; catalog entries exist already in the 44-provider
   catalog and must not report `executable` until an adapter ships.
4. **Free stock fallback (B4) — zero-key route.** Wikimedia Commons (already a
   research route) + Openverse API (no key) first; Pexels (free key) optional
   later. A project must render end-to-end with no API keys at all.
5. **Style consistency (B3).** A project-level style preset contributes a
   shared style prompt suffix and a shared seed to every scene generation
   request; preset id, prompt hash and seed are recorded per asset.
6. **Rights/provenance gate.** Every visual asset carries
   `{source, provider, model|collection, license, attribution, prompt_hash?, seed?}`
   in the manifest. Generated assets are marked `synthetic`; stock assets must
   carry a license identifier and attribution or the render fails closed.

## Consequences

- Renderer/pipeline changes are provider-agnostic; adding Stability later is
  an adapter file plus catalog wiring, no pipeline edits.
- Free tier stays honest: no keys → stock visuals, watermark-free, still a
  real video. Paid quality comes from BYOK generation, so our COGS stay ~0.
- Budget enforcement lands before the first paid call, keeping the "no
  surprise bills" guardrail from the master plan (§8.3 of the audit pricing
  doc) intact from day one.
- Mock-TDD covers contract/failure paths without keys; live smoke requires a
  FAL key (~$5–10) and is recorded in the readiness ledger like the
  ElevenLabs live smoke.
