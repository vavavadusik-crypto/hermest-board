# PHASE 10 — Documentation Audit

> Gate M10 audit. Maps the user/developer documentation checklist against the
> **actual** repository state (verified against source, not intent). Every
> command, path, flag, and env var referenced by the docs is checked against
> real code (grep/read) or by running it in this repo.
>
> Branch: `feat/m10-docs` · Date: 2026-07-24 · Baseline: `npm run validate` → `ok`.

## Legend

- **EXISTS** — present and substantially accurate; may need a light verify/link pass.
- **PARTIAL** — present but incomplete or not code-grounded for the PHASE-10 scope.
- **MISSING** — not present; must be created.

## Checklist

### User-facing

| # | Topic | State | File | Gap / action |
|---|-------|-------|------|--------------|
| 1 | README (what it is, capabilities, limits, install, first-run, providers, publishing honesty, matrix) | EXISTS | `README.md` | Comprehensive + honest matrix. Verify each command; add links to the new user docs (troubleshooting/backup/update/FAQ). |
| 2 | Deploy-mode matrix / self-host / Docker | EXISTS | `docs/DEPLOYMENT.md` | Accurate matrix (self-host ✅ / static ❌ / Vercel ❌). No change needed; cross-link from new docs. |
| 3 | Troubleshooting (real failure modes) | MISSING | `docs/TROUBLESHOOTING.md` | Create from real failure paths (ffmpeg/chromium/piper missing, worker-not-running, `voice_missing`, port-in-use, origin-forbidden). |
| 4 | Backup / restore | MISSING | `docs/BACKUP_RESTORE.md` | Create: board JSON export/import, `.data/` workspace SQLite, connectors. |
| 5 | Update / rollback | MISSING | `docs/UPDATE_ROLLBACK.md` | Create: git-based update, image rebuild, tag rollback, migration forward-only note. |
| 6 | FAQ | MISSING | `docs/FAQ.md` | Create: grounded in real behavior (free vs BYOK, why worker, publish honesty). |
| 7 | Contribution guide | EXISTS | `CONTRIBUTING.md` | No change; linked from README. |
| 8 | Roadmap | EXISTS | `ROADMAP.md` | No change; linked from README. |
| 9 | Security / privacy | EXISTS | `SECURITY.md`, `docs/SECURITY_REVIEW.md` | No change; cross-link. |

### Developer / reference

| # | Topic | State | File | Gap / action |
|---|-------|-------|------|--------------|
| 10 | Architecture (SPA + local-media worker + `api/` + render pipeline, data flow topic→MP4) | PARTIAL | `docs/ARCHITECTURE.md` | Present, but scoped to SPA + Vercel `api/` only. **Missing** the local-media vite-plugin worker and the real render pipeline / data flow. Augment. |
| 11 | Manifest schema (incl. editions/provenance) | MISSING | `docs/MANIFEST_SCHEMA.md` | Create from `src/media/manifest.js` (`buildRenderManifest`) + `src/media/edition.js` (`buildEditionManifest`). |
| 12 | Analytics schema | MISSING | `docs/ANALYTICS_SCHEMA.md` | Create from `deriveRenderAnalytics` in `src/local-media/job-manager.js`. |
| 13 | API reference (all routes: `api/` + local-media worker) | MISSING | `docs/API_REFERENCE.md` | Create as the single route index. `api/product` + public routes are documented in `STORAGE_AND_AGENT_API.md`/`PUBLIC_APIS.md`; the **local-media worker routes** (`/api/local-media/*`) are documented nowhere — enumerate them here and cross-link the rest. |
| 14 | Render pipeline (scenes → TTS → ffmpeg → MP4 + editions; deterministic notes) | PARTIAL | `docs/RENDER_PIPELINE.md` | `docs/MEDIA_RENDERING_ARCHITECTURE.md` exists as a **design/target** doc (2026-07-13), not a code-grounded pipeline reference. Create the grounded version. |
| 15 | Migrations (workspace SQLite) | MISSING | `docs/MIGRATIONS.md` | Create from `src/workspace/migrations/` + `migrate()` in `src/workspace/workspace-store.js`. |
| 16 | Release process | MISSING | `docs/RELEASE_PROCESS.md` | Create: `npm run check` gate → `release:manifest` → tag; honest CI-offload note. |
| 17 | Maintenance | MISSING | `docs/MAINTENANCE.md` | Create: routine tasks, dependency audit, data hygiene, log locations. |

## Related existing docs (cross-link, do NOT duplicate)

- `docs/STORAGE_AND_AGENT_API.md` — full `/api/product?route=*` contract.
- `docs/PUBLIC_APIS.md` — public/free research + AI + OAuth-start routes.
- `docs/CONNECTORS.md` — platform/connector requirements.
- `docs/MEDIA_RENDERING_ARCHITECTURE.md` — original media architecture decision (design intent).
- `docs/DATABASE_SCHEMA_DRAFT.md`, `db/postgres-schema.sql` — durable Postgres target.
- `docs/EXECUTION_STATE.md` — live checkpoint (source of truth for "where we are").

## Gap counts

- **Create (MISSING):** 9 — TROUBLESHOOTING, BACKUP_RESTORE, UPDATE_ROLLBACK, FAQ, MANIFEST_SCHEMA, ANALYTICS_SCHEMA, API_REFERENCE, MIGRATIONS, RELEASE_PROCESS, MAINTENANCE. *(10 files)*
- **Augment (PARTIAL):** 2 — ARCHITECTURE (add worker + pipeline), RENDER_PIPELINE (new code-grounded doc alongside the design doc).
- **Verify/link (EXISTS):** README + DEPLOYMENT + community files.

## Inaccuracies found in existing docs

- None blocking as of this audit. `docs/MEDIA_RENDERING_ARCHITECTURE.md` §2 lists a **target** file shape (`src/media/ffmpeg.js`, `src/domain/platform-recipes.js`, etc.); the real tree uses `src/media/ffmpeg-args.js` (and `platform-recipes.js` does exist). It is explicitly a design/decision doc, so this is intent-vs-implementation drift, not a false claim. `docs/RENDER_PIPELINE.md` supersedes it for the as-built pipeline. Any real code bug found while writing docs is flagged, not silently fixed (Gate M10 rule).
