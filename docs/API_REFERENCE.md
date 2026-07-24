# API Reference

Hermest Board exposes **two independent HTTP surfaces**:

1. **Local-media worker** — `/api/local-media/*`, served by the Vite plugin
   ([`src/local-media/vite-plugin.js`](../src/local-media/vite-plugin.js)) in
   `npm run dev` / `npm run preview` / the self-host container. This is where
   **real rendering, drafting, and editions** happen. **Loopback-only.**
2. **Vercel `api/` functions** — `/api/*`, serverless functions under
   [`api/`](../api). Public research, BYOK AI proxy, OAuth-start skeleton, and
   the product/storage contract. **No media bytes** run here.

> Grounded in the route dispatch in `src/local-media/vite-plugin.js` and
> `api/*.js`. Request/response shapes match the code. Full detail for the
> `api/product` contract lives in
> [`docs/STORAGE_AND_AGENT_API.md`](STORAGE_AND_AGENT_API.md); public/free
> routes in [`docs/PUBLIC_APIS.md`](PUBLIC_APIS.md). This file is the single
> route index and the **only** reference for the local-media worker routes.

---

## 1. Local-media worker — `/api/local-media/*`

### Security model (`vite-plugin.js`)

- **Loopback only.** The `Host` must resolve to `127.0.0.1`, `localhost`, or
  `::1`; anything else → `403 local_media_origin_forbidden`. A non-empty
  `Origin` must be `http:` on the same loopback host.
- **Mutation guard.** Every non-GET route requires header
  `x-hermest-local-media: 1` (else `403 local_media_mutation_header_required`)
  **and** `Content-Type: application/json` (else `415 application_json_required`).
- **Body limit.** JSON body ≤ 2 MiB, else `413 local_media_request_too_large`.
  Empty body → `400`; malformed JSON → `400 invalid_local_media_json`.
- **Error envelope.** Failures return `{ "ok": false, "error": "<message>", "code": "<code>" }`.
  Server (`5xx`) messages are generic (`local_media_internal_error`); provider
  strings and absolute paths are never leaked.

### Routes

| Method | Path | Auth | Success | Body / notes |
|--------|------|------|---------|--------------|
| GET | `/status` | loopback | `200` | `{ ok, mode:"local_only", renderer:"hermest-board-media-r1", publishEnabled:false }` |
| GET | `/providers` | loopback | `200` | `{ ok, providers }` — BYOK media key state (no secret values) |
| GET | `/bridge` | loopback | `200` | `{ ok, available, providers:[], reason }` — browser AI bridge probe; probe failure → `503 bridge_status_unavailable` |
| POST | `/providers/:provider/key` | mutation | `200` | body `{ key }` → sets a session BYOK key; returns `{ ok, provider }` |
| DELETE | `/providers/:provider/key` | mutation | `200` | clears the key; returns `{ ok, provider }` |
| POST | `/render` | mutation | `202` | body `{ project, projectId?, platform? }` → `{ ok, job }` |
| POST | `/edition` | mutation | `200` | body `{ project, targetLanguage, endpoint?, model? }` → `{ ok, edition, project }` |
| POST | `/draft` | mutation | `202` | body `{ topic, language?, sceneCount?, voice?, narrationProvider?, research?, model?, endpoint? }` → `{ ok, job }` |
| GET | `/draft/:draftId` | loopback | `200` | `draftId` = `draft_…`; `{ ok, job }`; unknown → `404 draft_job_not_found` |
| DELETE | `/draft/:draftId` | mutation | `202` | idempotent cancel; terminal → `409`; unknown → `404` |
| GET | `/jobs/:jobId` | loopback | `200` | `jobId` = `job_…`; `{ ok, job }` (job carries `analytics` when completed); unknown → `404` |
| DELETE | `/jobs/:jobId` | mutation | `202` | idempotent cancel; terminal → `409`; unknown → `404` |
| GET | `/jobs/:jobId/artifacts/:name` | loopback | `200` | streams the artifact (`Content-Disposition: attachment`, `no-store`, `nosniff`); missing → `404` |

### Cancel contract (`/draft/:id`, `/jobs/:id` DELETE)

`queued`/`running` and repeated cancels → `202` (idempotent). Terminal
(`completed`/`failed`) → deterministic `409`. Unknown id → `404`. Cancel never
returns `500` for a known job state.

### Request bodies

**`POST /render`** — `project` (object, required), optional `projectId`
(≤120 chars), optional `platform` (`^[A-Za-z0-9_-]{1,64}$`; e.g.
`youtube_video`, `youtube_shorts`, `tiktok`, `instagram_reels`). Returns a job;
poll `GET /jobs/:jobId`. Progress phases and outputs: see
[`docs/RENDER_PIPELINE.md`](RENDER_PIPELINE.md).

**`POST /draft`** — `topic` (string, ≤2000 chars, required); `language` (≤32),
`voice` (≤200), `narrationProvider` (≤64), `model` (≤64), `sceneCount` (number),
`research` (boolean, default `true`), and `endpoint`:
- `{ "kind": "bridge" }` — use the local browser AI bridge (default), or
- `{ "kind": "openai", "baseUrl", "apiKey", "model" }` — any OpenAI-compatible
  endpoint (BYOK). The key lives only in the job closure; it is never logged,
  stored, or written to any manifest/response.

**`POST /edition`** — `project` (object, required), `targetLanguage` (≤32,
required), optional `model` (≤64) and `endpoint` (same shape as draft).
Translates the finished project's narration and returns the translated board +
edition record. `voice_missing` is a **normal `200`** (not an error): the target
language has no offline Piper voice and no ElevenLabs key. The client then
renders the translated project through the existing `POST /render`. See
[`docs/RENDER_PIPELINE.md`](RENDER_PIPELINE.md) §Editions.

### Status codes → codes (`errorCode`)

`400 local_media_invalid_input` · `403 local_media_forbidden` ·
`404 not_found` · `409 local_media_conflict` ·
`413 local_media_request_too_large` · `415 application_json_required` ·
`429 local_media_capacity` · `503 local_media_upstream_unavailable` ·
`500 local_media_internal_error`.

---

## 2. Vercel `api/` functions

These are safe to deploy publicly; they contain no owner secrets and run **no
media**. BYOK keys are passed per request and are not persisted.

### Public / free & AI

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/health` | none | `200` deployment health check |
| GET | `/api/connectors/status` | none | reports which connector env vars are present (no values) |
| GET | `/api/public/sources` | none | public/free source registry (`200`) |
| GET | `/api/research/search?q=…` | none | server-side public source search; missing `q` → `400 missing_query` |
| GET | `/api/user-config/schema` | none | user-configurable schema + provider catalog (no secrets) |
| GET | `/api-provider-catalog.json` | none | static provider catalog (docs/signup metadata only) |
| POST | `/api/ai/respond` | BYOK (per request) | OpenAI + OpenAI-compatible chat proxy; key not stored |
| POST | `/api/publish-pack/validate` | none | validates publish-pack shape; complete → `200`, missing fields → `422`; non-POST → `405` |

### OAuth connectors (skeleton — **exchange NOT live**)

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/connectors/start?provider=youtube\|tiktok\|instagram` | Returns a signed-state start URL. Token exchange is **not implemented** → responds `501`. Unknown provider → `400 unknown_provider`. |
| GET | `/api/connectors/callback` | Validates the signed state; a valid callback still stops before token exchange → `501`. Invalid/expired state → `400`. |

> **Honest limitation:** OAuth token exchange for YouTube/TikTok/Instagram is
> intentionally not live. The board prepares a publish pack and an action queue;
> real posting requires the durable-storage + encrypted-token + platform-review
> work tracked in `ROADMAP.md`. See [`docs/CONNECTORS.md`](CONNECTORS.md).

### Product / storage contract — `api/product`

All product routes are addressed as `GET|POST|… /api/product?route=<path>`
(the `route` query is split on `/`). Full request/response detail, auth model,
and ownership metadata are documented in
[`docs/STORAGE_AND_AGENT_API.md`](STORAGE_AND_AGENT_API.md). Summary:

| Route (`?route=`) | Methods | Auth |
|-------------------|---------|------|
| `storage/status` | GET | none |
| `preflight` | GET | none |
| `session/current`, `session/bootstrap` | GET, POST | bootstrap issue needs `HERMEST_OWNER_TOKEN` + `HERMEST_SESSION_SECRET` |
| `auth/status`, `auth/signup`, `auth/login`, `auth/logout` | GET/POST | disabled unless `HERMEST_ACCOUNT_AUTH=1` + `HERMEST_SESSION_SECRET` + writable storage |
| `projects`, `projects/:id` | GET/POST/PUT/PATCH/DELETE | write needs owner token / signed session |
| `assets` | GET/POST | write-guarded |
| `jobs`, `jobs/:id`, `jobs/:id/approval` | GET/POST/PATCH | write-guarded; approval never executes publishing |
| `connectors`, `connectors/:id`, `connectors/capabilities` | GET/POST/DELETE | token writes need `HERMEST_TOKEN_ENCRYPTION_KEY`; tokens AES-256-GCM, never returned |
| `publish-candidates`, `publish-candidates/:id` | GET/POST | immutable sealed candidates; approval cannot publish |
| `publishing/platforms`, `publishing/platforms/:id` | GET | platform publishing status |
| `audit` | GET | latest audit events |
| `agent/plan` | POST | deterministic plan preview; `canAutopublish:false` |
| `workspace/*` | GET/POST/… | workspace CRUD over the SQLite store (see [`docs/MIGRATIONS.md`](MIGRATIONS.md)) |

**Write auth (`api/_lib/auth.js`).** When `HERMEST_OWNER_TOKEN` is configured,
write routes require `Authorization: Bearer <token>` or `x-hermest-owner-token`.
On public Vercel with `HERMEST_ENABLE_DEMO_STORAGE=1`, demo reads are also
owner-token gated. This is a bootstrap guard, not final SaaS auth.

---

## Smoke / verification

```bash
npm run smoke:api    # exercises the api/product contract in-process (no server)
npm run check        # full gate incl. real-ffmpeg render + smoke
```
