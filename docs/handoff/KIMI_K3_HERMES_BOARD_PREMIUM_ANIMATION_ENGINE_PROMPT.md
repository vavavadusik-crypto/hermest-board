# KIMI K3 IMPLEMENTATION PROMPT — HERMES BOARD PREMIUM CARTOON ANIMATION ENGINE

You are the primary implementation engineer for **Hermes Board**.

Work directly inside the current Hermes Board repository and implement the next real milestone. Do not provide only recommendations, pseudocode, mockups, or an architectural essay. Inspect the repository, preserve what already works, write production code, run tests, render a real validation video, and leave the repository in a stable continuation state.

## 1. Product context

Hermes Board is a local-first AI video-generation application.

The existing product can already perform parts of this workflow:

- accept a topic or user request;
- generate or receive a script;
- split the script into scenes;
- calculate approximate scene duration from narration;
- create a video project;
- render video in multiple aspect ratios;
- generate subtitles;
- save an MP4 and a production manifest;
- support local operation and optional external providers;
- preserve some continuity between episodes or recurring characters;
- use local voice-over.

The local voice-over is acceptable and is **not the main problem in this milestone**. Do not waste this milestone rewriting the TTS system. Keep the current voice pipeline compatible.

The major weakness is the visual engine.

The current output often looks like a sequence of flattened slides with static cartoon images. The scenes explain the product, but the animation feels lifeless. There is insufficient motion hierarchy, character movement, camera movement, parallax, timing, semantic emphasis, and continuity. The current result is not yet competitive with premium animation and AI-video products.

## 2. Mission

Build the foundation of a **real deterministic 2D cartoon-animation engine** for Hermes Board.

The target is not “add more random effects.” The target is a reusable animation runtime that can produce deliberate, premium, readable, and controllable motion.

Hermes Board must eventually compete with—and exceed—the practical quality and controllability associated with systems and concepts found in:

- Rive;
- Remotion;
- Motion Canvas;
- GSAP timelines;
- Lottie / dotLottie;
- Jitter;
- Vyond;
- Powtoon;
- Animaker;
- Adobe motion and compositing workflows.

Do not copy closed-source products. Study their public concepts and build an original, provider-neutral implementation suitable for Hermes Board.

## 3. Critical working rules

1. **Do not use subagents, agent swarms, or workflow orchestrators.**
2. Work as the single primary implementer.
3. Do not rewrite the whole product blindly.
4. Do not delete the legacy renderer.
5. Do not break the current working generation pipeline.
6. Do not add large dependencies without proving why they are required.
7. Do not combine several animation frameworks merely because they exist.
8. Prefer a small, coherent architecture over a collection of wrappers.
9. Never claim success without executable evidence.
10. Treat all generated code as untrusted until it compiles, passes tests, and renders correctly.
11. Make small, reviewable changes and atomic commits.
12. Keep a safe checkpoint before major modifications.
13. If the exact repository, branch, model name, command, or runtime is uncertain, inspect it. Do not invent it.
14. Quality is more important than speed or token consumption.
15. Do not stop after analysis. After the audit, begin implementation.

## 4. Current single milestone

Implement only:

# M1 — Scene Graph + Deterministic Timeline Core

Do **not** simultaneously attempt:

- a complete advanced character-rig editor;
- a marketplace;
- distributed rendering;
- dozens of external connectors;
- a total UI redesign;
- a complete TTS rewrite;
- a full 3D engine.

Those belong to later milestones.

M1 must provide the foundation that all later premium animation features can use.

## 5. Required target architecture

Use the existing codebase where possible, but move toward this architecture:

```text
Story Compiler
      ↓
Scene AST
      ↓
Scene Graph + Asset Graph + Continuity Graph
      ↓
Constraint Layout Engine
      ↓
Motion Planner
      ↓
Nested Timeline + State Machines
      ↓
Audio Graph + Word/Phoneme Timings
      ↓
Deterministic Frame Evaluator
      ↓
Renderer / Compositor
      ↓
Encoder Profiles
      ↓
MP4/WebM + SRT/VTT + Manifest + Editable Project Bundle
```

For this milestone, concentrate on:

```text
Scene AST
      ↓
Scene Graph
      ↓
Constraint Layout
      ↓
Deterministic Nested Timeline
      ↓
Frame Evaluator
      ↓
Renderer Adapter
```

## 6. Repository audit — perform this first

Before editing code, inspect and record:

- repository root;
- active branch and dirty state;
- build system;
- application entry points;
- current video-engine modules;
- current scene/project schema;
- renderer and compositor implementation;
- timeline and duration logic;
- subtitle implementation;
- asset-loading path;
- font-loading and text-measurement path;
- aspect-ratio handling;
- export and encoding pipeline;
- current tests;
- current demo or fixture videos;
- desktop preview or browser preview path;
- legacy renderer boundaries;
- relevant dependencies and their licenses.

Run the existing tests and record the baseline.

Create:

```text
docs/video-engine/M1_BASELINE_AUDIT.md
docs/video-engine/M1_DECISIONS.md
docs/video-engine/M1_STATUS.md
```

If equivalent project files already exist, update them instead of creating duplicates.

## 7. Scene Graph requirements

Create a versioned, serializable Scene Graph.

At minimum, support these node concepts:

- Scene;
- Group;
- Layer;
- Sprite/Image;
- Vector/Shape;
- Text;
- Subtitle;
- Camera;
- Mask;
- Effect;
- Audio reference;
- optional nested Composition.

Each node must have a stable ID and deterministic ordering.

At minimum, support these properties where relevant:

- parent/children hierarchy;
- local transform;
- position;
- scale;
- rotation;
- anchor/pivot;
- opacity;
- z-index or deterministic paint order;
- visibility;
- clipping/mask;
- blend mode if the current renderer supports it safely;
- layout constraints;
- safe-area metadata;
- semantic role;
- asset reference;
- animation bindings;
- accessibility or reduced-motion metadata;
- debug name.

Use a versioned schema and provide migration hooks. Do not bind the canonical project format directly to one external provider.

## 8. Deterministic timeline requirements

Use rational or integer frame-based time. Do not use float-only timing as the canonical source of truth.

Support:

- project FPS;
- frame index;
- rational time conversion;
- nested timelines;
- clips;
- labels;
- markers;
- keyframes;
- easing curves;
- relative timing;
- stagger;
- hold;
- sequence;
- parallel animation;
- loop with explicit bounds;
- deterministic arbitrary seek;
- deterministic evaluation without dependence on previously rendered frames.

A frame evaluated directly at time `T` must match the same frame produced by sequential playback.

Implement deterministic interpolation and document supported easing functions.

## 9. Motion system requirements

Create a coherent motion grammar.

M1 should support reusable motion primitives such as:

- fade;
- slide;
- scale;
- reveal;
- wipe or mask reveal;
- pop with overshoot and settle;
- spring-like motion implemented deterministically;
- staggered entrance;
- camera pan;
- camera zoom;
- parallax;
- emphasis pulse;
- idle drift;
- subtle breathing;
- blink trigger;
- simple head or hand gesture through transform hierarchies;
- exit transitions.

Do not use random values without a seeded deterministic source.

Effects must be parameterized and reusable. They must not be hardcoded per video.

The engine should be capable of producing premium motion by combining a small number of well-designed primitives rather than stacking uncontrolled effects.

## 10. Cartoon-animation proof scene

Build one real validation scene using layered assets already present in the repository or create simple original vector/shape fixtures.

The proof scene must demonstrate:

- at least two layered cartoon characters or character-like figures;
- a foreground, midground, and background;
- parallax;
- camera movement;
- staggered scene entrance;
- one character idle motion;
- one blink;
- one simple gesture;
- one speech-related semantic emphasis;
- one UI or text element animated independently;
- a clean transition to a second shot or composition;
- subtitles that do not collide with protected content;
- deterministic rendering.

Do not spend the milestone building a complete bone-rig editor. A transform hierarchy and reusable motion bindings are sufficient for M1.

The proof scene must visibly look more alive than the current flattened-slide output.

## 11. Responsive layout requirements

One Scene Graph must render into:

- 1920×1080 at 60 FPS;
- 1080×1920 at 60 FPS;
- 1080×1080 at 60 FPS.

Do not manually rebuild three unrelated scenes.

Implement:

- anchors;
- constraints;
- safe areas;
- min/max sizing where needed;
- protected subtitle regions;
- collision checks;
- optional layout variants only where constraints cannot solve the problem.

The renderer must produce a structured diagnostic when a layout cannot be resolved. Do not silently clip important content.

## 12. Subtitle requirements

Subtitles must be a separate first-class `SubtitleTrack` or equivalent—not permanently burned into source images.

Support:

- timed subtitle cues;
- safe margins;
- maximum line width;
- line wrapping;
- style tokens;
- collision avoidance with protected regions;
- export to SRT and VTT;
- optional burned-in rendering at final composition time.

Text measurement must be deterministic for the same fonts and environment.

## 13. Renderer strategy

First inspect the existing stack.

Select the smallest practical renderer architecture that fits the repository.

Possible implementation backends to evaluate—not automatically add—include:

- the existing renderer;
- Canvas 2D;
- Skia;
- WebGPU;
- SVG/vector rendering;
- Remotion as a renderer adapter;
- Motion Canvas concepts;
- FFmpeg for decode, encode, muxing, and filters;
- libass or equivalent for subtitle rendering;
- HarfBuzz/FreeType or equivalent where deterministic shaping is required.

Do not replace the application stack with a new framework unless the existing implementation makes M1 impossible and you can prove that with evidence.

The canonical Scene Graph and timeline must remain provider-neutral.

## 14. Encoder and quality requirements

Provide a real 1080p60 production profile.

Minimum target:

- 1920×1080;
- 60 FPS;
- H.264 High Profile or a clearly justified better supported codec;
- VBR;
- configurable target and maximum bitrate;
- target bitrate appropriate for UI graphics and animation;
- AAC 48 kHz at 192–256 Kbit/s or better;
- correct pixel format and color metadata;
- no accidental fallback to extremely low bitrate.

Also preserve existing supported formats where possible.

The encoder must report the final resolution, FPS, codec, bitrate, audio settings, duration, and output path in the manifest.

## 15. Compatibility requirements

The current/legacy renderer must remain available behind a compatibility interface.

Implement a clear renderer boundary such as:

```text
RendererBackend
- legacy
- scene_graph_v2
```

Existing projects should not become unreadable.

Add migration or adaptation from the current project/scene representation into the new Scene Graph where feasible.

If complete migration is not possible in M1, document exact limitations and provide a safe fallback.

## 16. Testing requirements

Add automated tests for:

- schema validation;
- schema serialization and deserialization;
- stable node ordering;
- rational time conversion;
- timeline nesting;
- easing evaluation;
- arbitrary seek determinism;
- seeded procedural motion;
- full-render vs chunked-render equivalence;
- responsive layout;
- subtitle wrapping;
- subtitle collision avoidance;
- missing-asset failure behavior;
- renderer cancellation;
- manifest output;
- legacy fallback.

Add golden-frame or image-hash tests for representative frames.

Do not make tests pass by weakening assertions or replacing real rendering with meaningless mocks.

## 17. Acceptance criteria

M1 is complete only when all of the following are demonstrated:

1. The repository builds successfully.
2. Existing critical tests still pass or regressions are explicitly fixed.
3. One versioned Scene Graph is used as input.
4. The same project renders correctly in 16:9, 9:16, and 1:1.
5. All three outputs render at 60 FPS.
6. Direct seeking to a frame matches sequential rendering.
7. Rendering the same frame twice produces the same hash.
8. Full rendering and chunked rendering are equivalent.
9. The proof cartoon scene contains visible layered motion, parallax, camera motion, idle motion, blink, gesture, and semantic emphasis.
10. Subtitles remain readable and do not overlap protected regions.
11. Missing assets produce explicit errors rather than broken or empty scenes.
12. The legacy renderer still functions.
13. Export produces:
    - MP4 or the current canonical video format;
    - SRT;
    - VTT;
    - render manifest;
    - diagnostics;
    - editable versioned project bundle.
14. A human can open and watch the generated validation video.
15. No completion claim is made without listing the exact output files and test results.

## 18. Execution protocol

Work in this order:

### Phase 0 — checkpoint
- inspect Git status;
- record baseline;
- create a safe branch or checkpoint according to the repository’s existing conventions.

### Phase 1 — audit
- map the existing engine;
- identify reusable code;
- write the baseline and decision documents.

### Phase 2 — schema and timeline
- implement versioned Scene Graph;
- implement rational time;
- implement deterministic timeline evaluator;
- add unit tests.

### Phase 3 — layout and renderer adapter
- implement constraints and safe areas;
- connect the evaluator to the renderer;
- preserve the legacy backend;
- add tests.

### Phase 4 — motion primitives
- implement the reusable motion grammar;
- add seeded deterministic procedural motion;
- add tests.

### Phase 5 — proof cartoon scene
- build and render the validation project;
- render 16:9, 9:16, and 1:1 at 60 FPS;
- produce representative frame hashes.

### Phase 6 — QA and documentation
- run the complete relevant test suite;
- inspect outputs;
- record performance;
- update status, decisions, and handoff;
- create atomic commits.

## 19. Required final report

At the end of this work session, report exactly:

```text
STATUS
- completed / partially completed / blocked

BASELINE
- repository
- branch
- previous renderer
- test baseline

ARCHITECTURE DECISION
- chosen implementation
- rejected alternatives
- reasons

FILES CHANGED
- exact paths

COMMANDS RUN
- exact commands

TEST RESULTS
- passed
- failed
- skipped
- duration

RENDER OUTPUTS
- exact paths
- resolution
- FPS
- codec
- bitrate
- duration
- hashes

PERFORMANCE
- render time
- real-time factor
- peak memory if measurable

KNOWN LIMITATIONS
- exact unresolved items

COMMITS
- commit IDs and messages

NEXT SINGLE STEP
- one clearly bounded next milestone
```

Update the project handoff so another engineer can continue without repeating the audit.

## 20. Start now

Begin by inspecting the repository and current video pipeline.

Do not ask me broad planning questions that can be answered by reading the code.

Ask only when a missing decision cannot be determined safely from the repository.

After the audit, immediately implement M1 and produce the real validation render.
