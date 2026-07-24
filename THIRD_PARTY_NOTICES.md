# Third-Party Notices

Hermest Board uses the following third-party dependencies at runtime and build time.

## Runtime Dependencies

### pg (PostgreSQL client)
- Version: 8.22.0
- License: MIT
- Copyright: Copyright (c) 2010-2024 Brian Carlson
- Repository: https://github.com/brianc/node-postgres

This package contains the following sub-dependencies with their respective licenses (all MIT):

- **pg-cloudflare** (1.4.0): PostgreSQL client for Cloudflare Workers
- **pg-connection-string** (2.14.0): PostgreSQL connection string parsing
- **pg-int8** (1.0.1): 64-bit integer handling
- **pg-pool** (3.14.0): Connection pooling for node-postgres
- **pg-protocol** (1.15.0): PostgreSQL wire protocol implementation
- **pg-types** (2.2.0): PostgreSQL data type serialization
- **pgpass** (1.0.5): PostgreSQL password file parsing
- **postgres-array** (2.0.0): PostgreSQL array parsing
- **postgres-bytea** (1.0.1): PostgreSQL bytea encoding/decoding
- **postgres-date** (1.0.7): PostgreSQL date parsing
- **postgres-interval** (1.2.0): PostgreSQL interval parsing
- **split2** (4.2.0): String splitting utility
- **xtend** (4.0.2): Object extension utility

## Development Dependencies

### vite (Build tool and dev server)
- Version: 7.0.0
- License: MIT
- Copyright: Copyright (c) 2019-present Evan You & Vite Contributors
- Repository: https://github.com/vitejs/vite

Build-time sub-dependencies (partial tree, MIT unless noted):

- **esbuild** (0.28.1): JavaScript bundler (MIT)
- **rollup** (4.62.2): JavaScript module bundler (MIT)
- **@rollup/rollup-linux-x64-gnu** (4.62.2): Rollup native binary for Linux x64 glibc (MIT)
- **@rollup/rollup-linux-x64-musl** (4.62.2): Rollup native binary for Linux x64 musl (MIT)
- **@esbuild/linux-x64** (0.28.1): esbuild native binary for Linux x64 (MIT)
- **postcss** (8.5.16): CSS transformation tool (MIT)
- **nanoid** (3.3.15): Unique ID generator (MIT)
- **picocolors** (1.1.1): Tiny ANSI colors library (ISC)
- **picomatch** (4.0.5): Glob matching library (MIT)
- **source-map-js** (1.2.1): Source map library (BSD-3-Clause)
- **@types/estree** (1.0.9): TypeScript definitions for ESTree (MIT)
- **fdir** (6.5.0): Fast directory traversal library (MIT)
- **tinyglobby** (0.2.17): Tiny glob library (MIT)

## Node.js Built-ins (No License Attribution Required)

This project uses the following Node.js built-in modules, which are part of the Node.js runtime (MIT License):

- `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:os`, `node:stream`, `node:util`, `node:url`, `node:http`, `node:sqlite`

## Media Assets

### FFmpeg (External System Dependency)
- License: LGPL 2.1+ / GPL 2+ (depending on build configuration)
- **Not bundled** — must be installed separately by the user
- Repository: https://github.com/FFmpeg/FFmpeg

### Fonts

**DejaVu Sans** (system font, not bundled)
- License: Free license (Bitstream Vera + Arev Fonts)
- Used for: FFmpeg subtitle rendering when the font is available on the host system
- Not redistributed with this application

### Music

**assets/music/calm-ambient-pad.m4a**
- **License: CC0 (Public Domain)**
- **Created by:** Hermest Board project team
- **Method:** Procedurally generated using freely available tools
- No third-party samples or copyrighted material used

### Runtime-Fetched Assets (Not Redistributed)

The application can optionally fetch the following resources at runtime when the user provides appropriate API keys or enables free sources:

- **Piper TTS voices** (RU/EN/ES/DE/FR) — downloaded on-demand from public repositories (MIT/Apache-2.0 models)
- **Pollinations.ai images** — generated via public API (no license encumbrance for outputs)
- **FAL.ai images** (if user provides BYOK key) — user's own license agreement with FAL
- **Pexels media** (if user provides BYOK key) — user's own license agreement with Pexels
- **ElevenLabs voices** (if user provides BYOK key) — user's own license agreement with ElevenLabs

None of these runtime-fetched assets are included in the repository or distribution package.

---

## License Summary

- All runtime JavaScript dependencies: **MIT**
- All build-time JavaScript dependencies: **MIT** (with one ISC and one BSD-3-Clause utility)
- Node.js built-ins: **MIT** (Node.js License)
- Procedurally generated music: **CC0 (Public Domain)**
- FFmpeg: **LGPL 2.1+ / GPL 2+** (external system dependency, not bundled)

**Redistribution of this project is clean:** all bundled dependencies are permissive, and no third-party copyrighted media/models are included.

---

Generated: 2026-07-24 (Gate M6)
