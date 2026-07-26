# Design connectors: Canva, Figma, Adobe, Google Drive

Checked against official documentation on 2026-07-26. Only public, documented APIs
with legal authentication are in scope. No private endpoint reverse engineering,
no web-session emulation, no scraping.

## Research outcome

| Service | Official public API | Auth | Operations relevant to the Board | Developer prerequisites |
| --- | --- | --- | --- | --- |
| Figma | REST API, `https://api.figma.com` | Personal access token in `X-Figma-Token`, or OAuth2 app | `GET /v1/files/{file_key}`, `GET /v1/files/{file_key}/styles`, `GET /v1/images/{file_key}` | Figma account, token generated in Settings → Security with scopes (`file_content:read`, `library_content:read`). No platform review. |
| Canva | Connect APIs, `https://api.canva.com/rest/v1` | OAuth 2.0 authorization code + PKCE (SHA-256), client secret server-side | `POST /asset-uploads`, `POST /exports`, brand template endpoints | Developer Portal integration. Public integration requires Canva review; private integration requires Canva Enterprise. Brand template APIs require a plan with brand templates. |
| Adobe | Firefly Services (image generation, Photoshop, Lightroom, Content Tagging) and Creative Cloud Libraries API | Firefly Services: OAuth Server-to-Server (`client_credentials`) against `https://ims-na1.adobelogin.com/ims/token/v3`. CC Libraries: OAuth 2.0 Web with `cc_files,cc_libraries` scopes | Firefly: generation endpoints. CC Libraries: read library elements | Adobe Developer Console project and credentials; Firefly Services is an entitlement-based (paid/enterprise) offering. Express add-ons run inside the Express editor, not as an outside REST API. |
| Google Drive | Drive API v3, `https://www.googleapis.com/drive/v3` | OAuth 2.0 | `GET /files` (search), `GET /files/{id}?alt=media`, `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=…` | Google Cloud project, Drive API enabled, OAuth consent screen, app verification. `drive.file` is non-sensitive; `drive`/`drive.readonly` are restricted and need a security assessment. |

## Step 1 — registry and catalog (commit 1)

1. `public/api-provider-catalog.json`: add `figma`, `canva`, `google-drive`,
   `adobe-cc-libraries`, `adobe-firefly` under a new `design_assets` category
   (Firefly stays in `image_video`).
2. `src/app.js`: register the `design_assets` category label so the catalog filter
   keeps working.
3. `api/_lib/connector-capabilities.js`: add `design.import`, `brand.assets`,
   `design.export`; add the Firefly adapter to `image.generate`; extend `adapter()`
   with static platform blockers (`canva_integration_review_required`,
   `google_oauth_app_verification_required`, `adobe_enterprise_entitlement_required`,
   …) so a platform approval requirement is a named blocker, not a footnote.
4. Every new adapter starts with `implemented: false` — the registry must not claim
   an adapter before it exists.
5. Tests in `test/unit/connector-capabilities.test.mjs` for the new states.
6. `docs/CONNECTORS.md`: service → capability → prerequisites → code status table.

## Step 2 — one real adapter (commit 2)

Figma REST with a personal access token: it is the only one of the four that a
developer can reach without platform moderation (Canva public integration review /
Canva Enterprise, Google OAuth verification, Adobe entitlement).

`src/connectors/figma-design.js`:

- operations `importFile`, `readBrandAssets`, `renderNodeImages`;
- `safeFetch` from `src/media/ssrf-guard.js` plus a hard `api.figma.com` allowlist;
- request timeout, bounded response body, bounded node id / parameter validation;
- token only from `FIGMA_ACCESS_TOKEN` server env, never from request bodies;
- provider error bodies never leave the module — only status-derived messages;
- documented `Retry-After` handling for 429;
- no new dependencies.

`test/unit/figma-design.test.mjs` drives everything through a fake `fetchImpl` and a
fake DNS lookup — no network.

Then `figma-file-import-v1` and `figma-brand-assets-v1` flip to `implemented: true`,
and the docs status column is updated to match.

## Gates

`npm run validate` and `npm run test:unit`.
