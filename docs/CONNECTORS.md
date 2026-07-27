# Connectors

This document describes the Board-owned connector capability layer and what must still be connected before Hermest Board can publish.

## Capability Router

The descriptive provider source remains `public/api-provider-catalog.json`. The runtime planner in `api/_lib/connector-capabilities.js` maps Board capabilities to versioned adapters without copying provider metadata or exposing credential values.

Safe status endpoint:

```text
GET /api/product?route=connectors/capabilities
```

States are deliberately stricter than configuration:

- `working_adapter` — implemented for the reported runtime and needs no credential;
- `configured_adapter` — implemented and a non-secret configuration signal is present;
- `configured_but_adapter_missing` — credentials exist but no executable adapter exists;
- `oauth_skeleton` — signed state foundation exists, token exchange does not;
- `approval_required` — publish capability also needs an immutable candidate and exact human approval;
- `blocked` — no executable route.

Current executable routes are the no-key public research aggregate, Commons search and local Flite only in `local_media`. FAL, Replicate, Stability, ElevenLabs, Deepgram, AssemblyAI, object storage and social provider entries remain adapter targets. A key or OAuth app pair never makes those routes executable by itself.

Autopublishing remains disabled.

## Design Services

Documentation for every row below was checked on **2026-07-26**. Only official,
public, documented APIs with legal authentication are listed; where an operation has
no public API, this document says so instead of inventing an adapter.

| Service | What the public API can do for the Board | What a developer must have | Status in this repository |
| --- | --- | --- | --- |
| [Figma REST API](https://developers.figma.com/docs/rest-api/) | Read a design file (`GET /v1/files/{file_key}`), read published styles (`GET /v1/files/{file_key}/styles`), render nodes to PNG/JPG/SVG/PDF links (`GET /v1/images/{file_key}`) | Figma account; personal access token created in Settings → Security with `file_content:read` and `library_content:read`, sent in the `X-Figma-Token` header; OAuth2 app for acting on behalf of other users. No platform review for personal tokens | **Implemented** in `src/connectors/figma-design.js`. `design.import` and `brand.assets` report `configured_adapter` and `executable` once `FIGMA_ACCESS_TOKEN` is set, `blocked` without it |
| [Canva Connect APIs](https://www.canva.dev/docs/connect/) | Exchange an OAuth code for tokens (`POST /rest/v1/oauth/token`), list and read designs (`GET /rest/v1/designs`, `GET /rest/v1/designs/{id}`), export a design as a job (`POST /rest/v1/exports` then `GET /rest/v1/exports/{id}`) | Integration registered in the [Developer Portal](https://www.canva.com/developers/integrations); OAuth 2.0 authorization code with PKCE (SHA-256) and a server-side client secret. A **public** integration must pass Canva review; a **private** integration requires Canva Enterprise. Brand template APIs additionally require a user plan that includes brand templates | **Implemented** in `src/connectors/canva-design.js`, tested against the documented contract but **never run against Canva** — no personal tokens exist there, so an integration is required to exercise it. `design.import` reports `configured_adapter`; blockers `canva_integration_review_required`, `canva_brand_template_plan_required` stay until someone runs it for real |
| [Adobe Creative Cloud Libraries API](https://developer.adobe.com/creative-cloud-libraries/) | Read brand elements (colors, character styles, graphics) from a user's Creative Cloud libraries | Adobe Developer Console project with the Creative Cloud Libraries API added, OAuth 2.0 Web credentials, scopes `openid,creative_sdk,profile,address,AdobeID,email,cc_files,cc_libraries` | `brand.assets` — `oauth_skeleton`, blocker `adobe_developer_console_project_required` |
| [Adobe Firefly Services](https://developer.adobe.com/firefly-services/docs/guides/) | Generative image APIs plus Photoshop, Lightroom and Content Tagging automation | Adobe Developer Console project with OAuth **Server-to-Server** credentials; tokens from `https://ims-na1.adobelogin.com/ims/token/v3` with scopes `openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis`; an entitled (paid/enterprise) Adobe organization | `image.generate` — adapter target, blocker `adobe_firefly_entitlement_required` |
| [Google Drive API v3](https://developers.google.com/workspace/drive/api/guides/about-sdk) | Search and read brand files (`GET https://www.googleapis.com/drive/v3/files`), download content (`files.get?alt=media`), deliver rendered videos (`POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`) | Google Cloud project with the Drive API enabled, OAuth consent screen, OAuth client. `drive.file` is a non-sensitive scope with a streamlined verification path; `drive` and `drive.readonly` are restricted scopes that require full verification and a security assessment | `design.import` / `design.export` — `oauth_skeleton`, blocker `google_oauth_app_verification_required` |

Adobe Express add-ons are **not** an outside REST surface: they run inside the Adobe
Express editor and are distributed through the Adobe Express Marketplace, so they
cannot be driven from this backend and no adapter is planned for them.

### Figma Adapter

`src/connectors/figma-design.js` is the only design adapter that exists as code.
It exposes three operations and nothing else:

- `importFile({ fileKey, depth })` — document metadata and page names, not the raw node tree;
- `readBrandAssets({ fileKey })` — published style keys, names, types and descriptions;
- `renderNodeImages({ fileKey, nodeIds, format, scale })` — render links per node, with
  unrenderable nodes returned separately in `failed`.

Safety properties, all covered by `test/unit/figma-design.test.mjs` against a fake
`fetchImpl` (the suite never touches the network):

- the token is read only from the `FIGMA_ACCESS_TOKEN` server env, never from a request
  body, and a missing token fails before any outbound call;
- every request goes through `safeFetch` from `src/media/ssrf-guard.js` with an
  `api.figma.com` allowlist, so a redirect to a private or loopback address is refused;
- file keys, node ids, image format and scale are validated before they reach a URL;
- responses are size-bounded and requests are timeout-bounded;
- provider error bodies are dropped unread — callers get a status-derived fact
  (`rejected the access token`, `was not found`, `failed with status N`), never upstream text;
- `429` is retried according to the documented `Retry-After` header, capped at 10 seconds.

There is no HTTP route exposing this adapter yet; it is a server-side module consumed
by the capability layer, and the registry claims exactly that and no more.

Server-side environment variables for these services (never sent from the browser,
never accepted from a request body):

```text
FIGMA_ACCESS_TOKEN
CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, CANVA_REDIRECT_URI
GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI
ADOBE_CC_LIBRARIES_CLIENT_ID, ADOBE_CC_LIBRARIES_CLIENT_SECRET, ADOBE_CC_LIBRARIES_REDIRECT_URI
ADOBE_FIREFLY_CLIENT_ID, ADOBE_FIREFLY_CLIENT_SECRET
```

## Immutable Approval Candidate

Before any social adapter may execute, approval must bind an exact sealed record:

- deterministic project snapshot, recipe, platform, artifact and manifest hashes;
- rights summary derived from stored project assets;
- workspace/owner authorization;
- exact candidate ID, digest and version repeated at approval time;
- immutable API surface with no update/delete route;
- approved jobs still blocked from `running` while queue/OAuth/provider-review blockers remain.

Public API requests can create only `metadata_only` candidates. They cannot claim `server_verified`, even if that field is sent in the request. The real media worker must independently verify and persist evidence before a candidate can become approvable.

## TikTok

Needed:

- approved TikTok developer app;
- OAuth flow;
- content posting permission;
- backend endpoint for token exchange and upload;
- policy review for automated publishing.

Current frontend behavior:

- prepares platform-specific title, description, hashtags, and asset requirements;
- exports a publish pack JSON.

## OAuth Safety Baseline

Current backend behavior:

- connector start URLs require provider client ID, redirect URI, and an OAuth
  state signing secret;
- OAuth state is HMAC-signed and expires;
- callbacks reject missing or invalid state before token exchange;
- connector token vault storage encrypts access/refresh tokens server-side and
  redacts token material from API responses;
- callbacks still stop before token exchange because provider exchange,
  disconnect flows, final user accounts, and provider review are not complete.

Use `HERMEST_OAUTH_STATE_SECRET` for OAuth state signing. `HERMEST_SESSION_SECRET`
can act as a fallback in controlled environments, but production should keep a
dedicated state secret.

Use `HERMEST_TOKEN_ENCRYPTION_KEY` before any backend route stores connector
tokens. Without it, token writes are rejected before storage.

## YouTube Video And Shorts

Needed:

- Google Cloud project;
- YouTube Data API enabled;
- OAuth consent screen;
- upload scope;
- backend endpoint for token exchange and uploads;
- vertical 9:16 asset for Shorts.

Current frontend behavior:

- creates specs for long `16:9` YouTube video;
- creates specs for vertical `9:16` Shorts.

## Instagram Reels

Needed:

- Meta app;
- Instagram professional account;
- connected Facebook page;
- Graph API permissions for content publishing;
- backend endpoint for media container creation and publish.

Current frontend behavior:

- prepares Reels-ready title, description, hashtags, and asset requirements.

## Parser / Research

Current backend capability:

1. Receive a bounded research query.
2. Search the implemented no-key public adapters with per-source timeouts.
3. Return links, facts, media candidates and citations from successful sources.

Still missing:

1. Bind selected results to project/source records.
2. Run rights and quality review before using media or quotes.
3. Mark every asset as usable, restricted or unknown.

## Translator

Future backend job:

1. Receive script and target languages.
2. Create localized scripts, titles, descriptions, hashtags, and subtitles.
3. Preserve technical terms such as Hermest, agents, graph, roadmap, and publish pack.
4. Return warnings where translation may change meaning.

## Media Generator

Future backend job:

1. Receive media brief and board structure.
2. Generate or retrieve images, b-roll, covers, and vertical clips.
3. Store assets with prompts, model names, source URLs, rights status, and usage notes.
4. Return render-ready assets for video generation.
