# Emergency checkpoint — 2026-07-28

## Remote repository state

- Repository: `vavavadusik-crypto/hermest-board`
- Source branch: `main`
- Protected checkpoint branch: `emergency-checkpoint-2026-07-28`
- Checkpoint base commit: `751aa67bf2d46fde373dcf20a5e4b71d321c2206`
- Commit message: `record what the 78.65 s investigation has ruled out`

## Important state already recorded upstream

The latest remote history includes work for:

- 1080p60 camera-aware scene delivery;
- desktop launcher and hands-on acceptance path;
- ElevenLabs voice selection including Aterna;
- scene-motion documentation;
- narration-aware list-item animation;
- failure evidence for broken renders;
- investigation of the horizontal render duration mismatch.

## Known unresolved issue

Horizontal rendering has reproducibly produced approximately `78.65 s` instead of the expected `121.73 s`, while the vertical render produced the expected duration. The duration gate correctly blocked the defective output. The investigation already ruled out the miniature filter graph, FFmpeg 6.1 versus 8.0 behavior, music mixing, disk capacity, and the reduced-frame probe. Remaining hypotheses include the background-video branch and a storyboard/narration duration mismatch.

## Chat-session technical artifacts

The following artifacts were generated and retained in the ChatGPT conversation. Their SHA-256 values are recorded for integrity verification:

- `KIMI_K3_HERMES_BOARD_PREMIUM_ANIMATION_ENGINE_PROMPT.md`
  - `f794e7ba6ca376f10652cf6a55ff07be49453761d27035e0a4ea1a3c7ac2f422`
- `CLAUDE_OPUS_5_VIDEO_ENGINE_HANDOFF.md`
  - `3d64dd8eaf4d5e18b204164b1045c3bc9e39611f06f7d27c46e6cf2c44a1d4b9`
- `Hermest_Video_Full_Audit_and_Engine_v2.md`
  - `c99f2698f38add0b6c60b512b81e461420a5ea40ba501e5275642da9d9a5414f`
- `hermest_video_engine_v2_spec.json`
  - `561cb1a0d5db517fba8d3e677ff1444c7e0801244abf8427adb80c0456e70d31`
- `adobe_render_timeline_v2.json`
  - `c99c27802bf09cbe3f1783ea8347a51bf35b51ed09c90d0b206af0b6fd87211c`
- `Hermest_Video_Delivery_Package.zip`
  - `9d10b14a719fb8457d1af27440d909919a9e403649f6b93433760228a89115cb`
- `Hermest_Board_Claude_Opus_5_English_Package.zip`
  - `ace63c8ddb9675d11c8c32c80ba3b837e098affca965e304667f0145efd2964a`

## Important limitation

This remote checkpoint protects the state already present on GitHub. It cannot capture uncommitted or unsaved files that exist only on the user's laptop. Before reboot, the local working tree must still be committed or archived from that machine.
