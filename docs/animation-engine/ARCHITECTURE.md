# Hybrid Animation Engine Architecture

## Decision

Hermest Board retains its existing deterministic media pipeline and gains Godot as an additional scene-composition backend.

Godot owns:

- 2D, 2.5D, and 3D scene state;
- skeletal and property animation;
- cameras, lights, particles, materials, and shaders;
- frame-accurate scene playback;
- scene serialization;
- lossless frame rendering.

Hermest Board owns:

- project and content workflow;
- narration and storyboard planning;
- jobs, cancellation, progress, and diagnostics;
- provider selection and policy;
- final audio/video assembly;
- subtitles, covers, manifests, provenance, hashes, and QC;
- user-facing orchestration controls.

Blender remains an external DCC and asset-authoring tool. It is not embedded into the runtime.

## Runtime topology

```text
Hermest Board browser
    |  HTTP local-only control plane
    v
Vite local-media worker (Node.js)
    |  fixed child-process launch
    v
Godot 4 runtime/editor
    ^
    |  ws://127.0.0.1:<ephemeral-or-configured-port>
    |  JSON-RPC 2.0 + protocolVersion 0.1.0
    |
Board animation client / local integration probe
```

Final render flow:

```text
project -> storyboard -> narration -> scene-composer provider
                                      |
                         +------------+-------------+
                         |                          |
                Chrome markup composer       Godot composer
                         |                          |
                         +------------+-------------+
                                      |
                           validated PNG sequences
                                      |
                       existing FFmpeg composition
                                      |
                         MP4 + SRT + cover + manifest
```

## Security boundaries

- Godot listens on `127.0.0.1` only.
- The worker never accepts an arbitrary executable path, command, argv array, project path, or bind address from the browser.
- `HERMEST_GODOT_PATH` must be absolute and executable.
- Protocol messages are limited to 1 MiB.
- Unknown methods and protocol versions fail closed.
- Scene and asset paths will be resolved under fixed repository/project roots before Phase 2 methods are enabled.
- Public Vercel/static deployments do not expose the local animation process API.

## Protocol rollout

Milestone 1 implements engine discovery first. All other contract methods are advertised as `planned`, not silently mocked.

Implemented now:

- `engine.ping`
- `engine.getCapabilities`
- `engine.getVersion`
- `engine.getDiagnostics`

Next:

- process-control route in local Vite middleware;
- real WebSocket ping integration test;
- `project.open` and `scene.load` with root-confined paths;
- `timeline.seek`, `timeline.play`, `timeline.pause`, `timeline.stop`;
- deterministic frame-sequence render;
- adapter into the existing `renderProject` scene-composer boundary.

## Compatibility profile

Milestone 1 uses Godot's Compatibility renderer for integrated Intel graphics and later Web export. Native GDExtension code is prohibited until profiling identifies a measured bottleneck.
