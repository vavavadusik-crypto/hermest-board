# Render Analytics Schema

When a local render job **completes**, the job manager derives a compact,
sanitized analytics summary from the verified render manifest and attaches it to
the public job as `job.analytics`. The UI renders it as the "Video analytics"
block on the finished render.

> Grounded in `deriveRenderAnalytics` in
> [`src/local-media/job-manager.js`](../src/local-media/job-manager.js). Field
> names below match the code 1:1. Source of truth is the render **manifest**
> (see [`docs/MANIFEST_SCHEMA.md`](MANIFEST_SCHEMA.md)), not any worker
> self-report.

## Contract

- **Only on `completed`.** `record.analytics` is set exactly when a job reaches
  `completed`; it is `null` for `queued`/`running`/`failed`/`cancelled`. A
  cancelled or late "zombie" result never publishes analytics.
- **Never crashes the render.** The whole derivation is wrapped in `try/catch`;
  on any error it returns `null` rather than failing the completed render.
- **Sanitized.** Text fields are length-capped and inline-sanitized
  (`sanitizeInlineText`, `MAX_ANALYTICS_TEXT_CHARS`); paths are not leaked.
  Hashes must match `/^[a-f0-9]{64}$/` or become `null`. Non-finite numbers
  become `null` (`finiteNumberOrNull`) — no invented zeros.

## Shape

```jsonc
{
  "durationSeconds": 64.2,        // manifest video probe.durationSeconds, else tts.durationSeconds, else null
  "integratedLufs": -16.0,        // manifest.qc.loudness.integratedLufs | null
  "loudnessRangeLu": 7.0,         // manifest.qc.loudness.loudnessRangeLu | null
  "truePeakDbtp": -1.5,           // manifest.qc.loudness.truePeakDbtp | null
  "voice": "en_US-…",             // manifest.tools.tts.voice (sanitized) | null
  "language": "en",               // manifest.tools.tts.language (sanitized) | null
  "recipeId": "youtube-16x9-1080p",
  "recipeHash": "<sha256>",       // manifest.recipeSha256 | null
  "sceneCount": 6,                // storyboard.json probe.scenes, else distinct footage sceneIndex count
  "footageCount": 6,              // manifest.footage.length
  "musicUsed": true,              // manifest.music is a non-empty object
  "artifactCount": 4,             // number of verified public artifacts
  "totalBytes": 1712345,          // sum of all artifact bytes
  "videoBytes": 1690000,          // main MP4 bytes | 0
  "videoSha256": "<sha256>",      // main MP4 hash | null
  "videoName": "youtube-16x9-1080p.mp4",  // sanitized name | null
  "videoType": "video/mp4",       // mime type | null
  "resolution": { "width": 1920, "height": 1080 },   // from probe.video.{width,height} | null
  "aspectRatio": "16:9",          // derived from resolution | null
  "qcPassed": true,               // manifest.qc.passed === true | null
  "blockers": [ "<text>" ],       // sanitized record.blockers
  "warnings": [ "<text>" ],       // sanitized record.warnings
  "completedAt": "2026-07-24T…Z"  // ISO timestamp | null
}
```

## Field notes

- **`durationSeconds`** — prefers the ffprobe-measured MP4 duration
  (`manifestVideo.probe.durationSeconds`), falling back to the TTS-reported
  duration; `null` if neither is a finite number.
- **`integratedLufs` / `loudnessRangeLu` / `truePeakDbtp`** — read from
  `manifest.qc.loudness`. The render targets **-16 LUFS** integrated,
  **-1.5 dBTP** true-peak (see the platform recipe).
- **`sceneCount`** — authoritative source is the storyboard artifact's
  `probe.scenes` (written by the renderer). If absent, it falls back to the
  count of distinct `sceneIndex` values in `manifest.footage` (a lower bound).
- **`resolution`** — taken strictly from the video stream section
  (`probe.video.{width,height}`), not the container. Partial/implausible
  dimensions degrade the whole field to `null`.
- **`videoBytes` / `videoSha256` / `videoName`** — resolved from the **public**
  artifact matching `<recipeId>.mp4` (else the first `video/mp4`), so they
  fingerprint the file the user actually downloads.
- **`blockers` / `warnings`** — carried through from the job record, sanitized.

## Where it is produced and consumed

- Produced: `deriveRenderAnalytics(record, result)` →
  `record.analytics` → exposed on `job.analytics` only for `completed` jobs
  (`src/local-media/job-manager.js`).
- Served: `GET /api/local-media/jobs/:jobId` (see
  [`docs/API_REFERENCE.md`](API_REFERENCE.md)).
- History: `docs/ANALYTICS_MILESTONE_HANDOFF.md`, `docs/milestones/M1_ANALYTICS.md`.
