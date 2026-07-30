# Hermest Animation Runtime

This directory contains the Godot-backed 2D/2.5D/3D animation runtime for Hermest Board.

Milestone 1 is deliberately narrow: prove a safe process lifecycle and a versioned loopback JSON-RPC bridge before scene authoring or rendering is connected to the existing media pipeline.

## Requirements

- Godot 4.x
- Compatibility renderer
- Node.js 20.11–22 for Hermest Board

## Start manually

```bash
export HERMEST_ANIMATION_PORT=37645
godot4 --path animation-engine/godot --headless
```

Or with an explicit executable path used by the Board worker:

```bash
export HERMEST_GODOT_PATH=/absolute/path/to/godot4
```

The bridge binds only to:

```text
ws://127.0.0.1:37645
```

## Implemented protocol methods

- `engine.ping`
- `engine.getCapabilities`
- `engine.getVersion`
- `engine.getDiagnostics`

All other methods in protocol `0.1.0` return `method_not_implemented` until their milestone is complete. No fake success responses are permitted.
