# Hybrid Animation Engine — Current Status

**Branch:** `feature/godot-hybrid-animation-m1`  
**Baseline inspected:** `main` at `1d5bd0dd2289ed733de3f1363ddae15ccbb132de`  
**Protocol milestone:** `0.1.0`  
**Status:** Phase 0 complete enough to begin Phase 1; integration is not complete.

## Repository facts observed

- The application is a Vite SPA with a local-only media worker mounted as a Vite plugin.
- Runtime requirement is Node.js `>=20.11 <23`.
- The existing render path is not a mockup. It builds narration, storyboard data, subtitles, frame sequences, MP4 output, cover frames, manifests, provenance, hashes, and quality checks.
- The current scene composer uses deterministic HTML/SVG markup rendered by one headless Chrome process through CDP.
- Scene frame sequences are validated for missing and empty frames before FFmpeg composition.
- The product already has a deterministic cartoon mode with persistent SVG puppets. That feature remains valuable and must not be deleted.
- The README reports a passing full gate with hundreds of unit tests and real media renders. This environment could inspect GitHub and write to the branch but could not clone the repository or rerun the complete repository gate because outbound DNS to GitHub is blocked.

## Architecture correction

Godot must not replace the existing media pipeline.

The correct integration boundary is a new scene-composer backend:

```text
Board / local-media API
        |
        v
existing renderProject orchestration
        |
        +-- narration / storyboard / subtitles / jobs / progress
        +-- scene composer provider
        |      +-- existing Chrome markup composer
        |      `-- new Godot composer
        +-- existing FFmpeg assembly / QC / manifest / hashes
```

This preserves the proven deterministic pipeline and limits Godot to the part it is meant to solve: real 2D/2.5D/3D scene authoring and frame rendering.

## Changes in the first Phase 1 spike

- Added a versioned Hermes Animation JSON-RPC contract.
- Added strict request parsing, a 1 MiB message limit, method allow-listing, protocol-version rejection, and structured errors.
- Added a safe Godot process manager. The binary path cannot come from an HTTP request; only a fixed platform allow-list or absolute `HERMEST_GODOT_PATH` is accepted.
- Added a minimal Godot 4 Compatibility-renderer project.
- Added a loopback-only WebSocket JSON-RPC runtime implementing:
  - `engine.ping`
  - `engine.getCapabilities`
  - `engine.getVersion`
  - `engine.getDiagnostics`
- Added Node unit tests for the protocol and process manager.

## Test evidence available now

The new isolated Node modules were executed under `node --test` in a temporary ESM project:

```text
8 tests
8 passed
0 failed
```

This evidence covers the new JavaScript modules only. The complete repository test gate and a real Godot launch remain **PENDING** until run in Codespaces or a machine with the repository and Godot 4 installed.

## Proven gaps

| Capability | Current state | Next evidence |
|---|---|---|
| Versioned animation protocol | Implemented in spike | repository unit gate |
| Safe Godot process lifecycle | Implemented with fakes | real Godot process launch |
| Godot WebSocket runtime | Source added | live `engine.ping` round-trip |
| Local-media API route | Not connected | integration test through Vite middleware |
| Scene load/save | Planned | persisted `.tscn` modification test |
| Timeline seek/play | Planned | frame-accurate Godot test |
| Godot frame sequence export | Planned | PNG sequence + completeness check |
| Existing FFmpeg pipeline reuse | Architecture selected | Godot composer provider integration |
| Board controls | Not started | UI-to-runtime acceptance test |
| 12–15 second vertical slice | Not started | exported artifact and manifest |

## Immediate next action

Connect the process manager to the local-only Vite worker behind explicit animation endpoints, then add an integration test that starts a fake manager and verifies status/start/stop behavior without accepting arbitrary binary paths or arguments. After that, run the same route against a real Godot 4 runtime and require a successful `engine.ping` response before scene work begins.
