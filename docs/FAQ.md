# FAQ

**Is Hermest Board free?**
Yes. There is a completely free path using piper TTS and Pollinations that requires no keys. Hermest Board is licensed under AGPL-3.0-or-later. Premium voices via ElevenLabs are available as a paid option (BYOK).

**Do I need API keys?**
No, API keys are optional. If you want to use premium services, you can supply BYOK keys (`HERMEST_ELEVENLABS_API_KEY`, `HERMEST_FAL_API_KEY`, `HERMEST_PEXELS_API_KEY`) via environment variables. Keys are never included in bundles or logs.

**Can it publish directly to TikTok/YouTube?**
Not yet. Direct auto-publish via OAuth token exchange is not implemented and currently returns a 501 status. For now, the board prepares a publish-pack (export) and platform status. No secrets are ever committed.

**What languages are supported?**
Free piper TTS supports ru_RU, en_US, es_ES, de_DE, and fr_FR. Premium ElevenLabs supports 29+ languages. If a language lacks an available voice, it returns a "voice_missing" status.

**Can I create multilingual editions? (verify)**
Language support spans the free piper voices and premium ElevenLabs languages. You can utilize these available languages based on your TTS provider selection.

**How do I self-host Hermest Board?**
For real rendering, use Docker: `docker compose up` (accessible at http://localhost:8080). For bare-metal, run `scripts/install.sh` then `PORT=8080 npx vite preview --host 0.0.0.0`. System requirements include Node.js >=20.11 <23, ffmpeg/ffprobe, and Chromium.

**Where is my data / privacy?**
Board data is stored locally in your browser's localStorage. Workspace data (clients/projects/campaigns) is stored in SQLite under `.data/hermest-board`. Renders are written to the physical `/tmp` directory (ephemeral). No secrets are ever committed.

**Is it production-ready?**
Hermest Board is a free, open-source **release candidate**, not a finished 1.0. The core creative pipeline (topic → research → storyboard → assets → voiceover → real MP4 → publish-pack) works and is verified by the CI quality gate (`npm run check`). Honest gaps: direct auto-publish via OAuth is **not** implemented (the board prepares a publish-pack instead); durable storage and multi-tenant accounts are partial and disabled by default. See the feature matrix in the README for the exact status of every feature.
