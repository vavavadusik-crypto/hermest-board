# ADR-003: B-roll Video Sources for Scene Backgrounds

Date: 2026-07-19 · Status: ACCEPTED · Phase: P2 (master plan the internal engineering plan)

## Context

Composed scene frames (scene-markup@1) carry the brand look, but long scenes
(90–120 s videos) need moving, on-topic background footage — the owner's
explicit product requirement: "фоновое видео, сгенерированное на основе того,
о чём агент рассказывает". Local diffusion video is impossible on this host
(no GPU). The render must stay deterministic per run and provenance-gated.

## Decision

1. **Provider-neutral b-roll port.** `src/media/broll-source.js` contract:
   `{ keywords, orientation, minDurationSeconds } → { path, license, provenance, sha256 }`
   — an MP4 clip downloaded into the private run dir. Adapters never leak
   keys; availability is reported honestly (`missing` without a key).
2. **Pexels Videos — first adapter (free key).** Free API, permissive Pexels
   License (attribution optional but always recorded: author, url, clip id).
   Query = scene keywords; pick the smallest file covering the recipe
   resolution; clip is trimmed/looped to the scene duration at render time.
3. **FAL text-to-video (LTX/WAN) — premium BYOK adapter, later.** Same port;
   generated clips are marked `synthetic` with prompt hash. Budget guard
   before any paid call (same pattern as ElevenLabs/FAL images).
4. **Composition mode.** When a scene has b-roll: background = clip scaled to
   cover, darkened (eq brightness/saturation) → branded frame overlays it as
   a transparent-background PNG (same markup, `transparent` mode, star field
   and glows off, panels on). Scenes without b-roll keep the opaque frame.
   Both modes concat into one timeline; argv stays schema-locked in the
   manifest, clip files are hashed like every artifact input.
5. **Rights gate.** Every clip carries `{source, provider, license,
   attribution, url|prompt_hash}` in the manifest; a clip without a license
   record fails closed before rendering.

## Consequences

- Zero-key renders still work (opaque branded frames); a free Pexels key
  upgrades every long scene to moving footage; a FAL key upgrades to
  generated footage — three honest quality tiers on one port.
- Downloaded clips make repeat-render byte-determinism dependent on the
  provider serving identical bytes; the manifest therefore records the clip
  sha256 as an input and repeat verification compares against it.
