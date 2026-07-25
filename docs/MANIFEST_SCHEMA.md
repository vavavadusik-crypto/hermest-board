# Render Manifest Schema

The render manifest is the verifiable record of a single MP4 render: which
inputs produced it, which tools/commands ran, quality-control results, and the
byte/hash fingerprint of every artifact. It is emitted by
[`buildRenderManifest`](../src/media/manifest.js) (`src/media/manifest.js`) and
consumed downstream by render analytics
([`docs/ANALYTICS_SCHEMA.md`](ANALYTICS_SCHEMA.md)) and by multilingual editions
([`buildEditionManifest`](../src/media/edition.js)).

> Grounded in `src/media/manifest.js` (`buildRenderManifest`, `normalize*`) and
> `src/media/edition.js` (`buildEditionManifest`). Field names below match the
> code 1:1. Every hash is a lowercase SHA-256 hex string (`/^[a-f0-9]{64}$/`),
> produced by `hashJson` (stable, key-sorted JSON stringify) or a raw byte hash.

## Design invariants

- **Deterministic.** `recipeSha256` and `inputs.*Sha256` are stable JSON hashes;
  the same project + recipe hash to the same values regardless of key order.
- **Secret-safe.** `commands[].argv` is filtered so API keys, tokens, cookies,
  `Authorization` headers, and credential URLs never appear
  (`SENSITIVE_FLAG` / `SENSITIVE_ASSIGNMENT` / `HEADER_FLAG` in `manifest.js`).
  Absolute filesystem paths are not embedded; artifact names are generated IDs.
- **Fail-closed on unverifiable evidence.** `normalizeArtifact`, `normalizeFootage`,
  and `normalizeMusic` throw if `bytes`/`sha256`/`license` are missing or invalid.
  A malformed footage/music/artifact record aborts manifest construction rather
  than emitting an unverified claim.

## Top-level shape (`buildRenderManifest`)

```jsonc
{
  "schemaVersion": 1,
  "renderer": "hermest-board-media-r1",
  "inputs": {
    "projectSha256": "<sha256 of the submitted project>",
    "storyboardSha256": "<sha256 of the derived storyboard>"
  },
  "recipe": { /* normalized platform recipe (key-sorted) — see below */ },
  "recipeSha256": "<sha256 of recipe>",
  "tools": { /* tool + TTS versions/metadata */ },
  "commands": [ /* redacted argv evidence */ ],
  "qc": { /* quality control */ },
  "blockers": [ "<text>" ],
  "warnings": [ "<text>" ],
  "lineage": { "parents": [], "children": [] },
  "footage": [ /* per-scene visual provenance */ ],
  "scenes": [ /* scene index/title/assetType */ ],
  "music": null,
  "artifacts": [ /* verified output files */ ]
}
```

## Fields

### `schemaVersion` / `renderer`
Constants: `1` and `"hermest-board-media-r1"`.

### `inputs`
- `projectSha256` — `hashJson(project)` of the submitted board project.
- `storyboardSha256` — `hashJson(storyboard)` of the derived storyboard.

### `recipe` + `recipeSha256`
The full platform recipe from `src/domain/platform-recipes.js`
(key-sorted clone), plus its stable hash. Recipe fields include `id`,
`platformId`, `width`, `height`, `fps` (30), `pixelFormat` (`yuv420p`),
`videoCodec` (`libx264`), `audioCodec` (`aac`), `audioSampleRate` (48000),
`loudnessTargetLufs` (-16), `subtitleMode` (`burn_and_sidecar`), `safeZones`,
and `readinessBlockers`. See [`docs/RENDER_PIPELINE.md`](RENDER_PIPELINE.md) for
the recipe table.

### `tools` (`normalizeTools`)
Only allowlisted keys survive. Text/number/boolean values for:
`ffmpeg`, `ffprobe`, `renderer`, `sceneComposer`, `chrome`.
Plus an optional nested `tts` object with allowlisted keys:
`provider`, `model`, `voice`, `language`, `durationSeconds`, `sampleRate`,
`channels`, `codec`, `scriptSha256`.

### `commands` (`normalizeCommands`)
Array of redacted command evidence:

```jsonc
{ "id": "render", "tool": "ffmpeg", "argv": [ "...redacted-safe args..." ] }
```

`id` must be one of `tts`, `narration-canonicalize`, `render`,
`render-composed`, `scene-browser`, `loudness-measure`, and `tool` must be
allowlisted for that id (`ffmpeg`, `piper`, or `chrome`). `argv` is bounded
(≤512 args, ≤16384 bytes each) and stripped of secrets.

`scene-browser` is the single headless Chrome launch that composes every scene
frame over the DevTools Protocol. Its argv schema is locked, including two
security invariants: `--remote-debugging-address=127.0.0.1` and an ephemeral
`--remote-debugging-port=0`. Individual frame captures are not separate
processes, so they produce no command evidence of their own — the frame content
is pinned by `markupSha256` plus `frameSha256` per scene, and the frame times
follow from the sequence framerate recorded in the `render-composed` argv.

### `qc` (`normalizeQc`)
```jsonc
{
  "passed": true,
  "checks": [ "<text>" ],
  "loudness": {              // optional
    "integratedLufs": -16.0,
    "truePeakDbtp": -1.5,
    "loudnessRangeLu": 7.0,
    "thresholdLufs": -26.0,
    "targetIntegratedLufs": -16.0,
    "targetTruePeakDbtp": -1.5,
    "targetLoudnessRangeLu": 11.0
  }
}
```
`passed` is strictly `=== true`. If `loudness` is present, **every**
`LOUDNESS_KEYS` field must be a finite number or construction throws.

### `blockers` / `warnings`
De-duplicated, trimmed text arrays.

### `lineage`
`{ parents: [text], children: [text] }` — de-duplicated edition/derivation links.

### `footage` (`normalizeFootage`)
One record per visual clip. Each requires a valid `sceneIndex`, an allowlisted
`assetType`, a non-empty `license`, and a verified `sha256`, else it throws.

```jsonc
{
  "sceneIndex": 0,
  "assetType": "generated-image",     // generative-clip | stock-footage | generated-image | deterministic
  "license": "<license record>",
  "sha256": "<sha256 of the asset bytes>",
  "source": "pollinations",           // provenance.source (default "unknown")
  "provider": "pollinations",         // provenance.provider (default "unknown")
  "author": "",                       // provenance.author (optional)
  "url": "https://…",                 // https-only, else ""
  "model": "flux",                    // provenance.model (optional)
  "promptSha256": "<sha256 or ''>"    // hash of the generation prompt
}
```

### `scenes` (`buildSceneManifest`)
```jsonc
{ "sceneIndex": 0, "title": "Scene 0", "assetType": "deterministic" }
```
`assetType` is joined from `footage` by `sceneIndex`; scenes without footage
default to `deterministic`.

### `music` (`normalizeMusic`)
`null`, or a verified bed:
```jsonc
{ "id": "…", "title": "…", "mood": "…", "license": "CC0", "sha256": "…", "source": "library" }
```
A music record without a `license` or a valid `sha256` throws.

### `artifacts` (`normalizeArtifact`)
Verified output files (MP4, SRT, storyboard.json, narration audio, …):
```jsonc
{ "name": "youtube-16x9-1080p.mp4", "type": "video/mp4", "bytes": 1234567, "sha256": "…", "probe": { /* ffprobe */ } }
```
`bytes` must be finite and > 0 and `sha256` valid, else it throws. `probe`
carries the ffprobe result (for video: `probe.video.{width,height}`,
`probe.durationSeconds`), used by analytics for resolution/duration.

## Edition manifest (`buildEditionManifest`, `src/media/edition.js`)

A multilingual **edition** is the same project rendered in another language. Its
manifest records the translation + voice provenance and (optionally) the render
fingerprint of the produced edition MP4. It requires `edition.status === "ready"`.

```jsonc
{
  "schemaVersion": 1,
  "kind": "multilingual-edition",
  "editionId": "edition_<16-hex>",       // deterministic: hashJson({projectId,targetLanguage})
  "projectId": "<source project id>",
  "sourceLanguage": "ru",
  "targetLanguage": "en",
  "voiceProvider": "piper",              // piper | elevenlabs
  "voiceId": "en_US-…",                  // or "elevenlabs:eleven_multilingual_v2"
  "translationModelId": "<model id or null>",
  "segments": [
    { "sceneId": "…", "sourceSha256": "<sha256>", "translatedSha256": "<sha256>" }
  ],
  "render": {                            // null, or the produced edition's render fingerprint
    "manifestSha256": "<sha256>",
    "videoSha256": "<sha256>",
    "recipeId": "youtube-16x9-1080p",
    "platform": "youtube_video"
  }
}
```

`segments[]` stores **only hashes** of the source and translated narration, not
the raw text — the public edition never leaks source or translated strings.
`render` is present only when a real render fingerprint is supplied
(`normalizeRenderProvenance` keeps only valid sha256/recipe/platform values).

Editions are produced through the existing render surface
(`POST /api/local-media/render`); there is no separate edition render path. See
[`docs/RENDER_PIPELINE.md`](RENDER_PIPELINE.md) §Editions and
[`docs/API_REFERENCE.md`](API_REFERENCE.md).
