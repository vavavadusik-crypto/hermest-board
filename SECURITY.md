# Security Policy

## Supported Versions

Only the **latest release** and the **current `main` branch** are supported for security updates. Older versions receive no security patches.

| Version | Supported          |
| ------- | ------------------ |
| `main` (HEAD) | ✅ Yes |
| Latest release tag | ✅ Yes |
| Older releases | ❌ No |

---

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.** Public disclosure before a fix is available puts all users at risk.

### How to Report

**Email:** vavavadusik@gmail.com  
**Subject:** `[SECURITY] <brief description>`

**Include in your report:**

1. **Description** of the vulnerability (what is affected, what can an attacker do)
2. **Steps to reproduce** (minimal, specific)
3. **Impact assessment** (confidentiality/integrity/availability, who is affected)
4. **Proposed fix** (optional, but helpful)
5. **Your contact information** (for follow-up questions)
6. **Disclosure timeline preference** (e.g., "30 days after fix is released")

**PGP key** (optional, for encrypted reports): Contact vavavadusik@gmail.com to request the public key.

### What to Expect

- **Acknowledgment:** Within **48 hours** of your report.
- **Initial triage:** Within **7 days**, we'll confirm whether the issue is a valid security vulnerability and its severity (Critical/High/Medium/Low).
- **Fix timeline:**
  - **Critical/High:** Patch within **14 days**, emergency release if needed.
  - **Medium:** Patch within **30 days**, included in next regular release.
  - **Low:** Patch within **60 days** or next minor release.
- **Coordinated disclosure:** We'll work with you on a public disclosure timeline (typically **30 days after fix is released**). You'll be credited in the security advisory unless you prefer to remain anonymous.
- **CVE assignment:** For Critical/High vulnerabilities affecting released versions, we'll request a CVE and publish a security advisory on GitHub.

### Out of Scope

The following are **not** considered security vulnerabilities:

- Denial of service via resource exhaustion on **local dev server** (it's not a public service).
- Social engineering attacks (phishing, etc.) — these are user responsibility.
- Vulnerabilities in third-party dependencies **already disclosed upstream** — report to the upstream project first; we'll update the dependency.
- Issues requiring physical access to the user's machine.
- Theoretical attacks with no practical exploit (we appreciate the heads-up, but they're deprioritized).

---

## Security Best Practices for Users

### Secrets Management

- **Never commit secrets** (API keys, passwords, tokens) to version control.
- **Use environment variables** or a secret manager (e.g., `.env` file excluded in `.gitignore`, system environment, cloud secret storage).
- **BYOK keys** (ElevenLabs, FAL, Pexels) are stored only in local worker memory (`process.env`) — they never appear in `localStorage`, manifests, or logs.

### API Keys and BYOK

- **Treat BYOK keys as sensitive** — don't share them, rotate them regularly, use provider-specific key restrictions (IP allowlists, usage quotas) when available.
- **Monitor usage** via provider dashboards to detect unauthorized use.

### FFmpeg and System Dependencies

- **Keep FFmpeg up to date** — security vulnerabilities in media processing are common. Install from trusted sources (official packages, Homebrew, apt).
- **Validate user-uploaded media** before processing (though Hermest Board currently doesn't accept arbitrary user uploads, this is a future consideration).

### Browser Security

- **Keep your browser up to date** — Hermest Board runs client-side JavaScript and uses `localStorage`.
- **Use HTTPS in production** — the development server (`npm run dev`) is HTTP-only; production deployments must use HTTPS to protect session data and prevent MITM attacks.

### Dependencies

- **Audit dependencies regularly:** Run `npm audit` and apply security patches.
- **Lock file hygiene:** Commit `package-lock.json` to ensure reproducible builds and avoid supply-chain attacks via version bumps.

---

## Security Features in Hermest Board

### What We Do to Keep You Safe

1. **Secrets never in code/logs/manifests:** All secrets are environment variables or encrypted storage. Sanitization of carrier forms (command-line arguments, error messages) prevents accidental leaks.
2. **Input validation and sanitization:** All external input (user input, API responses, file paths) is validated and sanitized to prevent injection attacks (XSS, command injection, path traversal).
3. **Content Security Policy (CSP):** The frontend enforces a strict CSP to prevent XSS.
4. **Fail-closed architecture:** Missing QC, rights, or provenance blocks the operation — no silent failures.
5. **Deterministic builds and manifests:** Reproducible renders with SHA-256 hashes prevent tampering.
6. **BYOK isolation:** User-provided API keys are isolated to the local worker process and never sent to third parties (except the provider the user explicitly chose).
7. **No public worker:** The media worker (FFmpeg rendering) is **deliberately absent** on public deployments (e.g., Vercel) — only local `npm run dev` runs it, preventing abuse.

### What You Should Know

- **Local storage is unencrypted:** Board data in `localStorage` is **not encrypted** — anyone with access to your browser can read it. Export sensitive boards to encrypted storage.
- **No authentication in local dev mode:** The local dev server (`npm run dev`) has **no auth** — it's meant for single-user local development. Production deployments with auth are a separate phase.

---

## Security Roadmap (Future)

- **Encrypted board storage:** Encrypt `localStorage` data with user-provided passphrase or hardware key.
- **Audit logging:** Log all sensitive operations (API key usage, render jobs, publish actions) for post-incident analysis.
- **Rate limiting and abuse prevention:** Per-user/workspace limits on API calls, render jobs, and storage.
- **OAuth token encryption at rest:** When auto-publish is implemented, OAuth tokens will be encrypted in durable storage (not plaintext).
- **Signed commits and release verification:** GPG-signed commits and release tags, automated SLSA provenance for builds.

---

## Acknowledgments

We appreciate responsible disclosure from security researchers and users. Contributors who report valid security vulnerabilities will be credited in:

- **Security advisories** (GitHub Security Advisories, CVE entries)
- **Release notes** for the patched version
- **`SECURITY.md` Hall of Fame** (if you'd like to be listed)

Thank you for helping keep Hermest Board secure! 🔒

## Deployment trust model

Hermest Board self-host is **single-tenant by default**. Understand the actor modes before exposing an instance to more than one person:

- **`signed-session`** — a real logged-in account. Per-record ownership (workspace / tenant isolation) is enforced: an actor only sees records in its own workspace.
- **`owner-token` / `development`** — the single operator of a self-hosted or local instance. These modes **intentionally bypass** per-record ownership: the operator owns every record. This is correct for a private, single-operator deployment.

**Do not** expose an `owner-token` or `development` actor on a shared, multi-user deployment — it would grant access to all records. A multi-tenant deployment must run with account auth (`HERMEST_ACCOUNT_AUTH=1`, durable storage, a session secret) so that every request resolves to a `signed-session` actor.

### Cookies over HTTPS

Session cookies are marked `Secure` automatically on Vercel, when the request arrives over HTTPS (`X-Forwarded-Proto: https`, e.g. behind a TLS-terminating reverse proxy), or when `HERMEST_FORCE_SECURE_COOKIES=1` is set. If you self-host over HTTPS without a proxy that sets `X-Forwarded-Proto`, set `HERMEST_FORCE_SECURE_COOKIES=1` so the session cookie is never sent in the clear.
