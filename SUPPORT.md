# Support

Thank you for using Hermest Board! This document explains how to get help, where to ask questions, and how to help others.

---

## Getting Help

### Documentation

**Start here:**

- **[README.md](README.md)** — Quick start, feature matrix, architecture overview.
- **`docs/` directory** — Detailed docs:
  - [ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture and design decisions.
  - [MEDIA_RENDERING_ARCHITECTURE.md](docs/MEDIA_RENDERING_ARCHITECTURE.md) — FFmpeg/TTS/worker boundary.
  - [CONTENT_PIPELINE_SPEC.md](docs/CONTENT_PIPELINE_SPEC.md) — Cards, storyboard, pipeline flow.
  - [CONNECTORS.md](docs/CONNECTORS.md) — Platform requirements and OAuth skeleton.
  - [PUBLIC_APIS.md](docs/PUBLIC_APIS.md) — Public/free APIs and security rules.
  - [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Hosting matrix and deploy instructions.
  - [SECURITY.md](SECURITY.md) — Security policy and best practices.

**Troubleshooting common issues:**

- **"Worker not available" / wizard doesn't work:** You must run `npm run dev` (not open `index.html` as a file) — the local dev server starts the media worker on `127.0.0.1:5173`.
- **FFmpeg errors / render fails:** Check that `ffmpeg` and `ffprobe` are installed and in your PATH (`ffmpeg -version` should work). Install via `apt install ffmpeg` (Linux), `brew install ffmpeg` (macOS), or download from [ffmpeg.org](https://ffmpeg.org/download.html) (Windows).
- **Piper voice errors:** Piper models are downloaded on first use. Check `HERMEST_PIPER_VOICES_DIR` or let the app use its default cache directory. Network issues during download → retry or manually download models from [Piper releases](https://github.com/rhasspy/piper/releases).
- **Browser AI bridge fails:** Ensure you've logged into the provider (ChatGPT/Gemini/DeepSeek/Perplexity) in Chrome and the bridge server is running on `127.0.0.1:8788`. See README "Локальный мост" section.
- **Ollama local model slow/fails:** Check Ollama is running (`ollama list`), the model is pulled (`ollama pull kimi-k2.7-code:cloud` or similar), and `HERMEST_BRIDGE_URL` points to `http://127.0.0.1:11434/v1/chat/completions` (or leave unset for default).

### Community Support

**GitHub Issues:** [https://github.com/vavavadusik-crypto/-8-/issues](https://github.com/vavavadusik-crypto/-8-/issues)

- Search existing issues first — your question may already be answered.
- For **bugs**, use the [bug report template](../../issues/new?template=bug_report.md).
- For **feature requests**, use the [feature request template](../../issues/new?template=feature_request.md).
- For **general questions**, open a [blank issue](../../issues/new) or use Discussions (if enabled).

**Response time:** Community support is best-effort. Maintainers and contributors will respond when available, typically within **2-7 days**. Faster responses for Critical bugs affecting many users.

### Paid Support

**Not currently available.** Hermest Board is a community-driven open-source project. For commercial support inquiries (SLA, dedicated help, custom features), contact vavavadusik@gmail.com.

---

## How to Ask Good Questions

To get a helpful answer quickly:

1. **Search first** — check README, docs, existing issues, and Discussions.
2. **Be specific:**
   - What did you do? (steps to reproduce)
   - What did you expect?
   - What actually happened?
   - Include **environment details:** OS, Node.js version (`node -v`), browser, FFmpeg version (`ffmpeg -version`).
3. **Provide logs/errors:**
   - Copy the **full error message** (redact any secrets/API keys).
   - Include browser console logs (F12 → Console tab) if it's a UI issue.
   - Include terminal output if it's a server/worker issue.
4. **Minimal reproduction:** If possible, describe the simplest way to trigger the issue (e.g., "Create a new board, add 3 cards, run wizard with topic 'quantum computing', render fails at scene 2").
5. **Redact sensitive data:** No API keys, personal data, or private project content in public issues.

**Good example:**

> **Title:** Render fails with "ffprobe: command not found" on Ubuntu 22.04
>
> **Body:**
> - **Environment:** Ubuntu 22.04, Node.js 22.3.0, npm run dev
> - **Steps:**
>   1. `npm install && npm run dev`
>   2. Open board, add 3 cards, run wizard with topic "AI"
>   3. Click "Render project"
> - **Expected:** MP4 renders successfully
> - **Actual:** Error: "ffprobe: command not found"
> - **Logs:**
>   ```
>   Error: spawn ffprobe ENOENT
>       at ChildProcess._handle.onexit (node:internal/child_process:286:19)
>   ```
> - **Notes:** `which ffprobe` returns nothing. Do I need to install FFmpeg separately?

**Bad example:**

> **Title:** It doesn't work
>
> **Body:** I tried to render a video but it failed. Help!

---

## Helping Others

**You can support the community by:**

- **Answering questions** in Issues or Discussions (even partial answers or pointers to docs help).
- **Reproducing bugs** reported by others (confirm "I can reproduce this on macOS 14" helps validate the issue).
- **Improving docs** — if you figured something out the hard way, submit a PR to clarify the docs for the next person.
- **Sharing tips and workarounds** — "I had the same issue and solved it by X" is incredibly valuable.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute code, tests, and documentation.

---

## Communication Channels

- **GitHub Issues:** Bug reports, feature requests, task tracking.
- **GitHub Discussions (if enabled):** General questions, ideas, show-and-tell, community chat.
- **Email (vavavadusik@gmail.com):** Security issues (see [SECURITY.md](SECURITY.md)), commercial support inquiries, private matters.

**Do not use email for general support questions** — use GitHub Issues instead, so the answer benefits everyone.

---

## Code of Conduct

All community interactions (issues, PRs, discussions, email) are governed by the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Be respectful, constructive, and patient. We're all here to learn and build together.

---

## Roadmap and Future Features

See [ROADMAP.md](ROADMAP.md) for what's planned and where help is needed. If your feature request aligns with the roadmap, mention it in your issue — it helps prioritize work.

---

## Thank You

Thank you for being part of the Hermest Board community! Your questions, bug reports, and feedback make the project better for everyone. 🎬
