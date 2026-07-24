# Architecture

## Current Shape

Hermest Board is a browser-first interactive product prototype:

- one-page Vite frontend;
- Vercel API layer under `api/`;
- local board state in `localStorage`;
- import/export through JSON;
- browser voiceover through `speechSynthesis`;
- browser recording through `MediaRecorder` and `getDisplayMedia`;
- publish pack generation as structured JSON.

## Runtime Surfaces

Hermest Board is not only the SPA + Vercel skeleton described above. The real
media product runs across **three** surfaces:

1. **Board (SPA)** — one-page Vite frontend (`src/app.js`, `index.html`). Board
   state in `localStorage`; JSON import/export; the creative control plane.
2. **Local-media worker** — a Vite plugin
   ([`src/local-media/vite-plugin.js`](../src/local-media/vite-plugin.js))
   mounted as middleware in `npm run dev` / `npm run preview` and inside the
   self-host container. It serves `/api/local-media/*` and is where **real MP4
   rendering, wizard drafting, and multilingual editions** actually execute. It
   is **loopback-only** and intentionally never public. Media bytes never touch
   Vercel Functions.
3. **Vercel `api/` functions** — the public, secret-free layer (health,
   research, BYOK AI proxy, OAuth-start skeleton, product/storage contract).

See [`docs/API_REFERENCE.md`](API_REFERENCE.md) for the full route index and
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for which surfaces each deploy mode has.

## Local-Media Worker

The worker (`src/local-media/`) is composed of:

- `vite-plugin.js` — HTTP routing, origin/mutation guards, error envelope.
- `job-manager.js` — render job lifecycle, cancellation, artifact resolution,
  and derived analytics ([`docs/ANALYTICS_SCHEMA.md`](ANALYTICS_SCHEMA.md)).
- `draft-job-manager.js` + `draft-service.js` — the async "topic → board"
  wizard (drafting can take minutes, so it is a polled job).
- `edition-service.js` — multilingual editions over the existing render surface.
- `provider-keys.js` — session-scoped BYOK media keys (kept in the worker
  process env, never persisted to disk or manifests).

The render itself lives in `src/media/` (`render-project.js` and collaborators)
and `src/domain/` (content pipeline, platform recipes). See
[`docs/RENDER_PIPELINE.md`](RENDER_PIPELINE.md).

## Data Flow (topic → MP4)

```text
topic
  → POST /api/local-media/draft   (wizard: research + script via bridge/BYOK model)
  → board (cards, script, storyboard)   [lives in localStorage; JSON export/import]
  → POST /api/local-media/render  (project + platform)
      → derive storyboard → TTS per scene (language = project param)
      → visuals (b-roll / generated image / deterministic fallback)
      → ffmpeg compose → <recipeId>.mp4  (H.264 / AAC)
      → loudness QC + ffprobe → verified render manifest
  → GET /api/local-media/jobs/:id → job.analytics + artifact download URLs
  → (optional) POST /api/local-media/edition → same video in another language
  → publish pack (structured JSON) + platform status   [OAuth exchange NOT live]
```

Every render artifact carries verified `bytes` + `sha256`; inputs and the recipe
are hashed. See [`docs/MANIFEST_SCHEMA.md`](MANIFEST_SCHEMA.md).

## Current API Layer

- `GET /api/health` - deployment health check;
- `GET /api/connectors/status` - reports whether connector env vars are present without exposing secrets;
- `GET /api/public/sources` - public/free source registry;
- `GET /api/research/search?q=...` - server-side public source search;
- `GET /api-provider-catalog.json` - static provider catalog for settings and BYOK key slots;
- `POST /api/ai/respond` - user-key AI response proxy for in-board BYOK testing across OpenAI and supported OpenAI-compatible providers;
- `GET /api/connectors/start?provider=...` - OAuth start URL with signed state for per-user account connection;
- `GET /api/connectors/callback` - validates signed state, then stops before token exchange;
- `GET /api/user-config/schema` - documents what users can configure without seeing owner secrets;
- `POST /api/publish-pack/validate` - validates publish pack shape before real publishing exists;
- `GET /api/product?route=storage/status` - reports storage durability and production blockers;
- `GET /api/product?route=preflight` - reports production-readiness gates without exposing secret values;
- `GET /api/product?route=session/current` - reports the current bootstrap actor/session contract;
- `GET /api/product?route=auth/status` - reports account-auth readiness and current actor;
- `POST /api/product?route=auth/signup` - creates a guarded account and sets an httpOnly signed session cookie when account auth is enabled;
- `POST /api/product?route=auth/login` - verifies a guarded account and sets an httpOnly signed session cookie;
- `POST /api/product?route=auth/logout` - clears the httpOnly session cookie;
- `GET /api/product?route=projects` and `POST /api/product?route=projects` - project list/create contract;
- `GET`, `PUT`, `PATCH`, `DELETE /api/product?route=projects/:id` - project detail/update/delete contract;
- `GET`, `POST /api/product?route=assets` - asset metadata contract;
- `GET`, `POST /api/product?route=jobs`, `GET`, `PATCH /api/product?route=jobs/:id`, and `POST /api/product?route=jobs/:id/approval` - job and approval contract;
- `GET`, `POST`, `DELETE /api/product?route=connectors` - redacted encrypted connector token vault contract;
- `GET /api/product?route=audit` - latest audit events;
- `POST /api/product?route=agent/plan` - deterministic backend plan preview for the publish pack.

## Deploy Boundary

The deployed frontend is safe to host publicly because it does not contain API secrets.
The Settings button owns local BYOK configuration. AI requests use a
bring-your-own-key flow: the user's selected provider key is kept in that user's
browser storage and sent to `/api/ai/respond` only for the current request.
The server endpoint does not persist the key or include it in project documents.
The current working AI providers are OpenAI Responses API plus OpenAI-compatible
chat-completions providers: Groq, Mistral, OpenRouter, DeepSeek, and Together AI.
The same settings area has browser-only slots for future parser, media,
translation, and workflow keys; these slots are not a production secret vault.
The provider catalog stores docs/signup metadata only. It does not include API
keys gathered from the internet.

All autonomous actions need a durable backend:

- OAuth for TikTok, YouTube, and Instagram;
- platform upload APIs;
- parser jobs;
- translation jobs;
- media generation jobs;
- asset storage;
- task queue;
- audit logs and retry handling.

The default JSON-file storage adapter is safe for local development. On public
Vercel it refuses writes unless demo storage is explicitly enabled, because
serverless `/tmp` storage is ephemeral and not suitable for private user data.
The product API calls storage through an adapter boundary. A guarded
`postgres-jsonb` adapter now exists for Neon/Supabase/Vercel Postgres style
durable storage, but production writes still require explicit enablement plus a
valid auth guard.

## Future Backend Modules

Recommended modules:

- `projects`: stores boards, roadmaps, scripts, and publish packs;
- `assets`: stores uploaded and generated media;
- `connectors`: stores OAuth state and encrypted access/refresh token envelopes server-side;
- `agent-queue`: runs parser, translation, rendering, and publishing tasks;
- `audit-log`: stores every automated action and error;
- `scheduler`: schedules drafts and publications;
- `metrics`: stores published links and platform metrics.

Project records now include `workspaceId`, `ownerUserId`, `createdBy`, and
`updatedBy` metadata so the future authorization layer has stable fields to
enforce against. These values are still bootstrap metadata until real sessions
exist.

The API can verify signed `hermest.v1` session tokens when
`HERMEST_SESSION_SECRET` is configured. It also has an owner-token gated
bootstrap issuer for controlled demo/migration sessions.

The account-auth foundation can create local/durable user records with scrypt
password hashes and issue httpOnly signed session cookies through
`auth/signup`, `auth/login`, and `auth/logout`. It is disabled by default and
requires `HERMEST_ACCOUNT_AUTH=1`, `HERMEST_SESSION_SECRET`, and writable
storage. This is a production-auth building block, not a complete SaaS identity
system: workspace membership, password reset, email verification, abuse
controls, and live unauthorized-path verification still remain.

## Data Model Draft

```text
Project
  id
  title
  boardJson
  plan
  roadmap
  script
  publishPack
  createdAt
  updatedAt

User
  id
  workspaceId
  email
  displayName
  passwordHash
  createdAt
  updatedAt

Asset
  id
  projectId
  type
  source
  storageUrl
  rightsStatus
  metadata

PublishJob
  id
  projectId
  platform
  language
  status
  assetIds
  publishedUrl
  errors
```

## Security Rules

- Never store platform client secrets in browser code.
- Treat generated and downloaded media as untrusted until scanned and rights-checked.
- Require explicit user approval before public posting until the product has mature safety controls.
- Keep a permanent audit trail for publishing actions.
