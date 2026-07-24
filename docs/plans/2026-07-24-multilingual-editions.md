# PLAN — Multilingual Editions (MVP, first slice)

Branch: `feat/mle-multilingual-editions`. TDD, additive, minimal diffs. Light checks only
(`validate`/`test:unit`/`build`); CI verifies the real edition MP4 render.

## Goal
From a COMPLETED project produce the SAME video in a target language B: translate the
narration, resolve B's voice, re-render the SAME scene structure with new audio → MP4 in B.
This extends existing multilingual voiceover into per-project editions. FUNCTIONALITY.

## Verified architecture (confirmed by reading source)
- Render consumes a `project` board: `cards[].title/text` + `brief.{language,voice,narrationProvider,topic,...}`.
  Narration is DERIVED from cards via `buildStoryboard` (scene.narration = title + text).
- Therefore an edition = a translated board (`cards` translated, `brief.language=B`, `brief.voice=B voice`)
  fed through the EXISTING `POST /api/local-media/render`. **render-project.js / content-pipeline.js are NOT touched.**
- Voice: `resolvePiperVoice` (ru/en/es/de/fr) → else ElevenLabs if `describeElevenLabsAvailability`=executable → else `voice_missing`.
- Text model: `createOpenAiTextModel` / `createBridgeTextModel` with `.complete({system,prompt})`.
  Translation must be temperature 0 → add optional `temperature` passthrough (default 0.4 preserved).
- Audio/asset separation by (text hash + language) holds by construction: translated text → different
  `scriptSha256` and different image-cache `prompt` key; each render uses a fresh temp dir → no clobbering.

## Slices (commit + push each; keep all 552 existing tests green)
1. **edition.js core (pure)**: `deriveEditionSegments`, `resolveEditionVoice`, `createEdition`
   (`draft`/`voice_missing`), segment shape `{sceneId, sourceText, translatedText, voiceId}`. Unit tests.
2. **translation + translated-project**: `translateEdition(edition,{translate})` (`draft→translating→ready`/`error`),
   `edition-translator.js` (`createEditionTranslator({textModel})`, temperature 0, strict prompt),
   `buildTranslatedProject`, temperature passthrough in text models. Unit tests (mock translator, deterministic).
3. **provenance**: `buildEditionManifest` records targetLanguage, translation model id, voice id, segment hashes,
   render manifest hash. Unit tests.
4. **server route+service**: `edition-service.js` (mirror draft-service model build) + `POST /api/local-media/edition`
   (returns translated `project` or `voice_missing`; client renders via existing `/render`). Unit tests (inject runEdition).
5. **UI trigger**: `index.html` + `src/app.js` — "Создать издание на [язык ▾]" on a completed render;
   status translating/ready/voice_missing via friendly-error + loading states + a11y. UI-wiring regex tests.
6. **docs**: EXECUTION_STATE + STOP-AND-REPORT follow-ups.

## STOP-AND-REPORT (NOT built here)
- RTL/CJK text-box transforms & font coverage (on-screen h1/subtitle rendering for non-Latin).
- Quota/rate-limit mid-batch resume.
- Manual translation editing UI.
- Bulk "all N languages at once" (MVP = one target language per action).

## Known limitation (honest)
- Scene timings follow the new audio (translated length differs) — same STRUCTURE/visuals, not identical durations.
- On-screen h1 heading = clamped translated text (title/body split heuristic); pixel-identical visual reuse
  (frozen seeds/asset hashes) is a follow-up.
