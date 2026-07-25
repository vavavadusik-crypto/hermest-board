# Render Pipeline

How a submitted project becomes a real, verified MP4. This is the as-built
reference; the original design/decision doc is
[`docs/MEDIA_RENDERING_ARCHITECTURE.md`](MEDIA_RENDERING_ARCHITECTURE.md).

> Grounded in [`src/media/render-project.js`](../src/media/render-project.js)
> and its collaborators (`narration.js`, `ffmpeg-args.js`, `scene-frames.js`,
> `image-source.js`, `broll-source.js`, `music-library.js`, `subtitles.js`,
> `loudness.js`, `manifest.js`). The renderer never runs on Vercel — only in the
> local-media worker (`npm run dev` / `preview` / self-host container).

## Entry point

`POST /api/local-media/render` → job manager → `renderProject({ project,
platform, signal, outputDir, onProgress })`. Outputs go to per-run temp
directories (`mkdtemp` under the output root); filenames are generated IDs, not
user strings; the run dir is cleaned up after artifacts are finalized.

## Phases (progress `label`s emitted to the UI)

`renderProject` reports these phases via `onProgress` (see
`the progress contract`):

| Phase | Label (RU) | What happens |
|-------|-----------|--------------|
| `preflight` | «Подготовка проекта» | Validate project, derive storyboard, resolve platform recipe, create run dir |
| `scenes` | «Сцена N из M» | Per scene: synthesize narration audio (TTS), canonicalize to WAV |
| `audio` | «Сборка озвучки» | Concatenate scene narration, build subtitles (SRT) |
| `encode` | «Кодирование видео» | Acquire visuals (b-roll/images/deterministic), compose frames, ffmpeg render |
| `finalize` | «Проверка качества и манифест» | Loudness QC, ffprobe, build + verify the render manifest |

`done` is set only by the job manager on real completion; cancelled/failed jobs
never report a false `done`, and late "zombie" reports are ignored.

## Data flow

```text
project (board)                         topic → wizard draft (POST /draft)
   │                                       │  produces the board this render consumes
   ▼
derive storyboard (scenes + narration text)
   │
   ▼  per scene
TTS adapter.synthesize({ text, language, voice, outputPath, signal })
   │        language = project.brief.language (default "en")
   │        voice    = project.brief.voice
   ▼
scene WAVs → concatenated narration.wav  +  narration.srt (subtitles)
   │
   ▼
visual acquisition per scene (see Visuals)  →  scene frames (Chromium composer)
   │
   ▼
ffmpeg render (safe argv, no shell)  →  <recipeId>.mp4  (H.264 / AAC)
   │
   ▼
loudness measure + ffprobe  →  buildRenderManifest(...)  →  verified artifacts
```

## TTS / narration (`selectNarrationAdapter`, `src/media/narration.js`)

Language is a **project parameter** (`project.brief.language`) — multilingual
voiceover is a real, shipped feature. Adapter selection:

- **Explicit `narrationProvider`:**
  - `elevenlabs` → requires an executable ElevenLabs key, else throws (BYOK).
  - `piper` → requires an executable Piper install, else throws.
  - `flite` → deterministic offline test voice.
- **Default (no provider):** try **Piper** (offline, free; languages
  `ru`, `en`, `es`, `de`, `fr`); if Piper is not executable, fall back to the
  **Flite** deterministic voice so a render always produces real audio.

Flite is an offline/test-quality fallback, not the release voice. ElevenLabs
(BYOK) covers "any language"; Piper covers the five offline languages.

## Visuals

Two acquisition kinds, gated by `brollMode`
(`auto` | `free` | `premium` | `deterministic`; env `HERMEST_BROLL_MODE`
overrides `project.brief.brollMode`):

- **Stock b-roll video** — Pexels (`broll-source.js`), keyed.
- **Generated / stock images** (`image-source.js` cascade, in order):
  1. **FAL** flux/schnell — BYOK (only if `FAL_API_KEY` present);
  2. **Pollinations** — free, **no key**, always available (reliable fallback);
  3. **Pexels photos** — BYOK (only if `PEXELS_API_KEY` present).
- **Deterministic fallback** — every scene without acquired footage renders a
  generated title-card. A provider outage can never erase the ability to produce
  a complete video.

Image/video generation is **opt-in**: enabled by `project.brief.generateVisuals`
or the presence of a keyed image provider (`hasKeyedImageProvider`). By default,
renders are deterministic and offline (no network), which keeps the test gate
non-flaky. Scene frames are composed by a headless Chromium composer
(`scene-frames.js`, `HERMEST_CHROME_PATH`).

### Scene frame capture (`chrome-cdp.js`)

The composer starts **one** headless Chrome for the whole render and drives it
over the DevTools Protocol (`Page.navigate` + `Page.captureScreenshot`) through
Node's built-in `WebSocket` — no browser-automation dependency is added. Chrome
picks a free port itself (`--remote-debugging-port=0`, loopback only) and
publishes it in `DevToolsActivePort` inside a throwaway profile under the run
directory.

Determinism is unchanged: every frame is still a **fresh document** loaded at
`#t=<ms>`, which the markup uses to pin each CSS animation to its exact virtual
time and freeze it. Seeking animations inside an already-loaded document is
faster still, but leaves composited layers promoted by earlier frames, which
shifts anti-aliasing on a few dozen pixels — so the composer reloads instead.
Frames of one scene are independent, so they are spread over a small pool of
tabs (`HERMEST_SCENE_CAPTURE_WORKERS`, default `min(4, cores - 1)`); the frame
index alone decides the output filename, so capture order cannot affect output.

Verified against the previous one-process-per-frame path: all 498 frames of
`examples/ai-subscriptions-60s.ru.json` and the resulting MP4 are byte-identical,
while the render step dropped from 376 s to 138 s on an 8-core box.

## Music

Optional CC0 music bed from the local library (`music-library.js`,
`selectMusicTrack` by mood). Recorded in the manifest with a license + verified
`sha256`; ducked under narration in the mix.

## Platform recipes (`src/domain/platform-recipes.js`)

| `platformId` | recipe `id` | Resolution | Notes |
|--------------|-------------|-----------|-------|
| `youtube_video` | `youtube-16x9-1080p` | 1920×1080 (16:9) | master; `maxDurationSeconds` 21600 |
| `youtube_shorts` | `shorts-9x16-1080p` | 1080×1920 (9:16) | aspect-only R1; ≤180 s; `semantic_edit_not_implemented` |
| `tiktok` | `tiktok-9x16-1080p` | 1080×1920 (9:16) | aspect-only R1; ≤180 s |
| `instagram_reels` | `reels-9x16-1080p` | 1080×1920 (9:16) | aspect-only R1; ≤180 s |

All recipes: `fps` 30, `pixelFormat` `yuv420p`, `videoCodec` `libx264`,
`audioCodec` `aac`, `audioSampleRate` 48000, `audioChannels` 2,
`loudnessTargetLufs` -16, `subtitleMode` `burn_and_sidecar` (burned-in **and**
sidecar SRT). Vertical recipes carry `readinessBlockers:
["semantic_edit_not_implemented"]` — they are honest aspect-ratio reframes, not
a semantic re-edit.

## Determinism notes

The audio graph is built for reproducible output
(`buildComposedRenderArgs` in `src/media/ffmpeg-args.js`):

- Audio frames are re-chunked with **`asetnsamples=n=1024:p=0`** on the
  narration, music, and mixed streams, so ffmpeg's threaded scheduler feeds
  fixed, deterministic frame boundaries (avoids sample-count drift between runs).
- Streams are normalized with `aformat=sample_rates=<sr>:channel_layouts=stereo`
  before mixing.
- Final loudness normalization: **`loudnorm=I=-16:TP=-1.5:LRA=11`**.
- Video runs at a fixed `fps`; `zoompan`/`tpad`/`trim` use frame-count math from
  `durationSeconds * fps`.

Because inputs and the recipe are hashed (`inputs.projectSha256`,
`recipeSha256`) and each artifact carries verified `bytes` + `sha256`, a render
is a fingerprinted, auditable artifact — see
[`docs/MANIFEST_SCHEMA.md`](MANIFEST_SCHEMA.md) and
[`docs/ANALYTICS_SCHEMA.md`](ANALYTICS_SCHEMA.md).

## Editions (multilingual)

An **edition** re-renders the same finished project in another language. It does
**not** touch `render-project.js`: an edition is a translated board
(`cards` translated, `brief.language = target`, voice for the target) fed through
the **existing** `POST /api/local-media/render`.

1. `POST /api/local-media/edition` translates the narration and resolves a
   target voice (Piper `ru/en/es/de/fr` → ElevenLabs → `voice_missing`).
2. `voice_missing` is a normal `200` (no offline voice + no ElevenLabs key),
   with a user-safe RU message — not an error.
3. On `ready`, the client renders the translated project via `POST /render`,
   producing a separate MP4. The source board is untouched.
4. `buildEditionManifest` records translation + voice provenance and per-segment
   source/translated **hashes** (never raw text).

Follow-ups (not implemented): RTL/CJK text-box shaping + font coverage, resume
mid-batch on quota/rate-limit, manual translation editing, bulk "all languages
at once", pixel-identical visual freeze. See `CHANGELOG.md` and the README roadmap.

## Verification

The render integration test (`npm run test:media`,
`test/integration/render-project.test.mjs`) asserts a real ffmpeg render: exit 0,
manifest schema/fields, non-empty MP4 + SRT, ffprobe-visible H.264 video + audio,
correct 16:9 / 9:16 dimensions, positive duration, and that input text/secrets
never leak into command logs. Generated outputs are gitignored.
