# Contributing to Hermest Board

Thank you for your interest in contributing! Hermest Board is an open-source AI content studio, and contributions are welcome in all forms: bug reports, feature requests, code improvements, documentation, design, testing, and community support.

---

## Quick Links

- **Code of Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — be respectful and constructive.
- **Security:** [SECURITY.md](SECURITY.md) — report vulnerabilities privately.
- **Support:** [SUPPORT.md](SUPPORT.md) — get help and help others.
- **Roadmap:** [ROADMAP.md](ROADMAP.md) — see what's coming and where help is needed.

---

## How to Contribute

### 1. Reporting Bugs

**Before opening an issue**, check if the bug has already been reported. If not, open a [new issue](../../issues/new?template=bug_report.md) with:

- A clear title and description
- Steps to reproduce (minimal, specific)
- Expected vs. actual behavior
- Environment (OS, Node.js version, browser, FFmpeg version)
- Relevant logs or screenshots (redact any secrets/personal data)

**Security vulnerabilities:** Do **not** open a public issue. See [SECURITY.md](SECURITY.md) for private reporting instructions.

### 2. Suggesting Features

Open a [feature request](../../issues/new?template=feature_request.md) with:

- The problem you're solving or use case
- Proposed solution (optional — we can brainstorm together)
- Alternatives you've considered
- Any relevant examples from other tools

**Check the [Roadmap](ROADMAP.md) first** — your feature may already be planned.

### 3. Contributing Code

#### Development Setup

1. **Fork the repo** and clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/hermest-board.git
   cd hermest-board
   ```

2. **Install dependencies** (requires Node.js 20.11+ and `ffmpeg`/`ffprobe`):
   ```bash
   npm install
   ```

3. **Run locally:**
   ```bash
   npm run dev   # dev server + media worker on 127.0.0.1:5173
   ```

4. **Run tests:**
   ```bash
   npm run test:unit    # fast unit tests
   npm run test:media   # integration tests (2 real FFmpeg renders)
   npm run check        # full quality gate (before PR)
   ```

5. **GitHub Codespaces:** Click **Code** → **Codespaces** → **Create codespace on main** for a zero-setup cloud dev environment (ffmpeg pre-installed).

#### Code Style

- **Clean architecture:** Domain → Application → Infrastructure → Presentation layers, dependencies point inward.
- **Self-documenting code:** Clear names, comments only for non-obvious logic (why, not what).
- **Fail-closed:** Missing QC/rights/provenance = block, never pass silently.
- **Secrets:** Only in environment variables or secret storage, never in code/logs/manifests.
- **Determinism:** Same input → same manifest/hashes (non-deterministic generation is fixed via provenance).

#### Pull Request Workflow

1. **Create a branch** for your change:
   ```bash
   git checkout -b fix/issue-123-short-description
   ```

2. **Make your changes:**
   - Write tests first (TDD: red → green → refactor).
   - Keep commits small and atomic.
   - Use clear commit messages (imperative mood, e.g., `fix: handle missing ffprobe output`).

3. **Run the quality gate:**
   ```bash
   npm run check   # must pass before PR
   ```

4. **Push and open a PR** against `main`:
   - Link the related issue (`Fixes #123` in PR description).
   - Describe what changed and why.
   - If the PR includes breaking changes, document the migration path.

5. **CI will run** the full gate (unit + media + build + smoke). All checks must pass.

6. **Code review:** Address feedback, push additional commits. Do **not** force-push after review starts (preserves review context).

7. **Merge:** Once approved and CI green, a maintainer will merge your PR.

#### First-Time Contributors

Look for issues labeled [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) or [`help wanted`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22). Don't hesitate to ask questions in the issue or PR — we're here to help!

### 4. Improving Documentation

Documentation contributions are highly valued! Areas include:

- **README / quickstart guides** (clarity, missing steps, Codespaces troubleshooting)
- **API docs / inline comments** (especially for complex modules like `src/media/render-project.js`)
- **Architecture docs** (`docs/ARCHITECTURE.md`, `docs/MEDIA_RENDERING_ARCHITECTURE.md`)
- **Tutorials / examples** (e.g., "How to add a new TTS provider")

Submit doc improvements as PRs just like code.

### 5. Testing and QA

Testing contributions:

- Add test cases for edge cases or uncovered code paths
- Run `npm run check` on different platforms (Windows, macOS, Linux) and report issues
- Test browser compatibility (Chrome, Firefox, Safari, Edge)
- Verify accessibility (keyboard navigation, screen readers)

### 6. Community Support

Help others in [GitHub Discussions](../../discussions) or [issues](../../issues) by:

- Answering questions
- Reproducing and triaging bug reports
- Sharing tips, workarounds, and best practices

---

## Development Guidelines

### Architecture Invariants

1. **Layers:** Domain (storyboard/pipeline — pure functions) → Application (jobs/candidates) → Infrastructure (FFmpeg/TTS/providers/storage) → Presentation (UI/API). Dependencies only inward. New adapters only through existing ports (e.g., `tts.js` contract, capability router).
2. **Determinism:** Same input → same manifest/hashes. Non-deterministic operations (generation) are fixed in manifest (model, prompt-hash, seed if available).
3. **Fail-closed:** Absence of QC/rights/provenance = block, never silent pass. Precedents already in code (`requirePassedRenderQc === true`).
4. **Secrets:** Only BYOK vault / `${ENV}`; never in manifest, logs, or argv (sanitization of carrier forms already exists — do not weaken it).
5. **Money under control:** Any paid call = up-front estimate + hard budget + UsageRecord. Retry after paid side effect only via reconciliation.
6. **Honesty of statuses:** Vocabulary VERIFIED/PARTIAL/MOCKED/MISSING/BLOCKED; claims without evidence don't get promoted. Docs updated in the same PR as code.
7. **TDD:** First a failing narrow test, then code, then full gate. Without tests, the task doesn't exist.

### Testing

- **Unit tests:** `test/unit/*.test.mjs` — fast, isolated, no network/filesystem.
- **Integration tests:** `test/integration/*.test.mjs` — real FFmpeg renders, real HTTP calls to local worker.
- **Smoke tests:** `scripts/smoke-*.mjs` — end-to-end sanity checks.
- **All tests must be deterministic** and pass on every run. Flaky tests are treated as failing tests.

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short summary>

<optional body>

<optional footer>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`.

**Examples:**
- `feat(wizard): add multilingual edition support`
- `fix(render): handle missing ffprobe output gracefully`
- `docs: update CONTRIBUTING with Codespaces instructions`
- `test(media): add determinism check for music auto-ducking`

### Dependency Management

- **Prefer built-in Node.js modules** over external dependencies (e.g., `node:crypto` over `crypto-js`).
- **New runtime dependencies** require discussion and approval (increases bundle size and supply-chain risk).
- **Check licenses:** All dependencies must be OSI-approved permissive licenses (MIT, Apache-2.0, ISC, BSD-3-Clause). No proprietary or AGPL dependencies (if we choose Apache-2.0 license).
- **Audit new dependencies:** Run `npm audit` and verify the package on npm/GitHub before adding.

### Security

- **No secrets in code/logs/tests/commits** — use environment variables or secret storage.
- **Input validation:** All external input (user input, API responses, file uploads) is untrusted. Validate, sanitize, and apply strict bounds.
- **OWASP Top 10:** Prevent injection, XSS, CSRF, insecure dependencies, etc.
- **Report security issues privately** — see [SECURITY.md](SECURITY.md).

---

## License and Copyright

By contributing to Hermest Board, you agree that your contributions will be licensed under the same license as the project (see `LICENSE` file — owner decision pending). You retain copyright to your contributions, but grant the project a perpetual, worldwide, non-exclusive, royalty-free license to use, modify, and distribute your work.

**Do not submit code you don't have the right to share.** If you include third-party code or assets, ensure they are compatible with the project license and properly attributed.

---

## Communication

- **GitHub Issues:** Bug reports, feature requests, task tracking.
- **GitHub Discussions:** General questions, ideas, show-and-tell.
- **Pull Requests:** Code and documentation contributions.

**Be respectful, constructive, and patient.** We're all here to build something useful together. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

---

## Recognition

Contributors will be recognized in release notes and the project's contributor graph. Significant contributions may be highlighted in the README or docs.

Thank you for making Hermest Board better! 🎬
