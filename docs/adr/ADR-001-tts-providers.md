# ADR-001: TTS Providers for Multilingual Narration

Date: 2026-07-19 · Status: ACCEPTED · Phase: P1 (master plan the internal engineering plan)

## Context

The North Star pipeline requires release-quality narration in the project's
language (Russian first; launch matrix RU/EN/ES/DE/FR; "any language" as a
premium mode). The existing offline adapter (ffmpeg `flite`) is English-only
and robotic — it fails the product bar for every target language. The host has
no NVIDIA GPU (14 GiB RAM), so GPU-bound local models are out of scope.
Architecture constraint: narration goes through the provider-neutral TTS port
(`src/media/tts.js` contract: text → WAV + metadata + hash); providers are
adapters, the pipeline never knows a provider by name.

## Decision

1. **Piper (rhasspy) — default provider.** Local, free, CPU-friendly VITS
   models, 30+ languages. Voice catalog per language (see
   `PIPER_VOICE_CATALOG` in `src/media/piper-tts.js`):
   - `ru`: `ru_RU-dmitri-medium` (Дмитрий), `ru_RU-irina-medium` (Ирина/Светлана)
   - `en`: `en_US-lessac-medium` · `es`: `es_ES-davefx-medium`
   - `de`: `de_DE-thorsten-medium` · `fr`: `fr_FR-siwis-medium`
   Binary: `~/.local/opt/piper/piper` (override: `HERMEST_PIPER_PATH`).
   Voices: `~/.local/share/piper/voices` (override: `HERMEST_PIPER_VOICES_DIR`).
   Missing binary/model is an honest fail-closed status
   (`missing_binary` / `missing_voice_model` / `no_voice_for_language`),
   never a crash and never a silent English fallback when Piper was requested
   explicitly.
2. **Determinism.** `--noise_scale 0 --noise_w 0` pins VITS generator noise so
   repeated synthesis is byte-identical, preserving the manifest/hash
   reproducibility invariant of the media gate (verified 2026-07-19:
   sha256-identical repeated renders).
3. **ElevenLabs `eleven_multilingual_v2` — premium BYOK provider** and the
   "any language" mode (29+ languages). API key only from the encrypted BYOK
   vault; never in manifest, logs, or argv. Character usage recorded toward
   UsageRecord; hard per-job budget; retry with backoff. (Adapter: task P1.3.)
4. **flite stays** solely as the zero-dependency offline smoke path for CI/dev
   machines without Piper. It is not a product voice.

Selection lives in `src/media/narration.js` (`selectNarrationAdapter`):
explicit provider wins; otherwise Piper when executable for the project
language, else honest fallback to flite (with its `english_only` warning
surfacing in metadata).

## Alternatives considered

- **Coqui XTTS-v2** — best local quality, but GPU-bound; unusable on this host.
- **espeak-ng direct** — every language, but robotic; fails the product bar.
- **Cloud-only (ElevenLabs/OpenAI/Azure)** — violates the free local-first
  tier, adds per-render cost and privacy concerns; kept as premium BYOK only.
- **Silero (torch)** — good RU, but pulls a PyTorch runtime into a Node
  pipeline; Piper covers RU at comparable quality with a single small binary.

## Consequences

- Adding a language = adding a catalog entry + downloading a model; no
  pipeline changes (language is a parameter, not a hardcode).
- Manifest must record language/voice/provider lineage for every narration
  (P1.8) and validate the exact Piper argv shape (done in
  `src/media/manifest.js`).
- Timeline reconciliation (P1.4) uses measured ffprobe durations, so scene
  timing is provider-independent.
