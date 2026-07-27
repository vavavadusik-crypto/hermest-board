// Canva Connect adapter. Endpoints, auth mode and the export job shape below were
// taken from the official documentation on 2026-07-27:
//   overview + base URL   https://www.canva.dev/docs/connect/
//   authentication        https://www.canva.dev/docs/connect/authentication/
//                         (OAuth 2.0 authorization code + PKCE, Bearer access token)
//   token exchange        https://www.canva.dev/docs/connect/api-reference/authentication/exchange-access-token/
//   list designs          https://www.canva.dev/docs/connect/api-reference/designs/list-designs/
//   get design            https://www.canva.dev/docs/connect/api-reference/designs/get-design/
//   create export job     https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/
//   get export job        https://www.canva.dev/docs/connect/api-reference/exports/get-design-export-job/
//
// HONEST STATUS: this code has never talked to Canva. Canva issues no personal
// access token — every call needs an integration registered by the self-hoster
// (public integrations require Canva review, private ones require Canva
// Enterprise), so the adapter cannot be exercised end to end from here. It is
// written against the documented contract and covered by tests on that contract;
// the `canva_integration_review_required` blocker in the capability registry
// stays exactly where it is until someone runs it against a real integration.
//
// Credentials are server-side only. The client id, secret and access token are
// never accepted from a request body and never echoed back.

import { readBoundedJson } from "../media/bounded-body.js";
import { isAllowedProviderUrl, safeFetch } from "../media/ssrf-guard.js";

const CANVA_PROVIDER = "canva";
const CANVA_API_ORIGIN = "https://api.canva.com";
const CANVA_API_HOSTS = Object.freeze(["api.canva.com"]);
const CANVA_TOKEN_ENV = "CANVA_ACCESS_TOKEN";
const CANVA_CLIENT_ID_ENV = "CANVA_CLIENT_ID";
const CANVA_CLIENT_SECRET_ENV = "CANVA_CLIENT_SECRET";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_DESIGNS = 100;
const MAX_TITLE_CHARS = 200;
const RETRY_DELAYS_MS = Object.freeze([500, 1500]);
const MAX_RETRY_AFTER_MS = 10000;
const MAX_EXPORT_POLLS = 20;
const EXPORT_POLL_DELAY_MS = 1500;

// Canva ids are opaque tokens in URLs. Anything with a slash, dot or escape would
// let a caller steer the request path, so ids are validated before they reach a URL.
const DESIGN_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const EXPORT_FORMATS = new Set(["png", "jpg", "pdf", "pptx", "mp4", "gif"]);

export function describeCanvaAvailability({ env = process.env } = {}) {
  const hasToken = Boolean(readToken(env));
  const hasClient = Boolean(readClientId(env) && readClientSecret(env));
  return {
    provider: CANVA_PROVIDER,
    // Three honest states, not two: an integration that exists but has not been
    // through the OAuth dance is a different problem from having no integration.
    status: hasToken ? "executable" : hasClient ? "missing_access_token" : "missing_integration",
    tokenEnv: CANVA_TOKEN_ENV,
    clientEnv: [CANVA_CLIENT_ID_ENV, CANVA_CLIENT_SECRET_ENV],
    docs: "https://www.canva.dev/docs/connect/"
  };
}

export function normalizeCanvaDesignId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!DESIGN_ID_PATTERN.test(id)) throw new TypeError("Canva design id is malformed");
  return id;
}

export function normalizeCanvaExportFormat(value) {
  const format = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EXPORT_FORMATS.has(format)) throw new TypeError("Canva export format is not supported");
  return format;
}

export function createCanvaDesignAdapter({
  env = process.env,
  fetchImpl = safeFetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  sleep = defaultSleep
} = {}) {
  const context = { env, fetchImpl, timeoutMs, maxResponseBytes, sleep };

  return {
    provider: CANVA_PROVIDER,

    /** Exchange an authorization code for tokens. PKCE verifier is required. */
    async exchangeCode({ code, codeVerifier, redirectUri, signal } = {}) {
      const clientId = readClientId(env);
      const clientSecret = readClientSecret(env);
      if (!clientId || !clientSecret) {
        throw new RangeError(`Canva integration is not configured (${CANVA_CLIENT_ID_ENV}, ${CANVA_CLIENT_SECRET_ENV})`);
      }
      if (!isNonEmptyString(code)) throw new TypeError("Canva authorization code is required");
      if (!isNonEmptyString(codeVerifier)) throw new TypeError("Canva PKCE code verifier is required");
      if (!isNonEmptyString(redirectUri)) throw new TypeError("Canva redirect URI is required");

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        code_verifier: String(codeVerifier),
        redirect_uri: String(redirectUri)
      });
      const payload = await request(context, {
        path: "/rest/v1/oauth/token",
        method: "POST",
        body: body.toString(),
        contentType: "application/x-www-form-urlencoded",
        // Documented client authentication for this endpoint is HTTP Basic.
        authorization: `Basic ${base64(`${clientId}:${clientSecret}`)}`,
        signal
      });
      return normalizeTokens(payload);
    },

    /** Refresh an expiring access token. */
    async refreshToken({ refreshToken, signal } = {}) {
      const clientId = readClientId(env);
      const clientSecret = readClientSecret(env);
      if (!clientId || !clientSecret) {
        throw new RangeError(`Canva integration is not configured (${CANVA_CLIENT_ID_ENV}, ${CANVA_CLIENT_SECRET_ENV})`);
      }
      if (!isNonEmptyString(refreshToken)) throw new TypeError("Canva refresh token is required");
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(refreshToken) });
      const payload = await request(context, {
        path: "/rest/v1/oauth/token",
        method: "POST",
        body: body.toString(),
        contentType: "application/x-www-form-urlencoded",
        authorization: `Basic ${base64(`${clientId}:${clientSecret}`)}`,
        signal
      });
      return normalizeTokens(payload);
    },

    /** Designs the authorised user can see, trimmed to what a board can use. */
    async listDesigns({ query = "", limit = 20, signal } = {}) {
      const search = {};
      const trimmed = typeof query === "string" ? query.trim().slice(0, MAX_TITLE_CHARS) : "";
      if (trimmed) search.query = trimmed;
      const payload = await request(context, {
        path: "/rest/v1/designs",
        search,
        authorization: bearer(env),
        signal
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const bounded = Math.min(Math.max(Number(limit) || 20, 1), MAX_DESIGNS);
      return {
        designs: items.slice(0, bounded).map(normalizeDesign).filter(Boolean),
        continuation: typeof payload?.continuation === "string" ? payload.continuation : ""
      };
    },

    async getDesign({ designId, signal } = {}) {
      const id = normalizeCanvaDesignId(designId);
      const payload = await request(context, {
        path: `/rest/v1/designs/${encodeURIComponent(id)}`,
        authorization: bearer(env),
        signal
      });
      const design = normalizeDesign(payload?.design ?? payload);
      if (!design) throw new RangeError("Canva returned a design without an id");
      return design;
    },

    /**
     * Export a design. Canva answers with a job, so the adapter polls it — but a
     * bounded number of times: a job that never finishes must surface as a timeout
     * rather than hold the caller forever.
     */
    async exportDesign({ designId, format = "png", signal } = {}) {
      const id = normalizeCanvaDesignId(designId);
      const type = normalizeCanvaExportFormat(format);
      const created = await request(context, {
        path: "/rest/v1/exports",
        method: "POST",
        body: JSON.stringify({ design_id: id, format: { type } }),
        contentType: "application/json",
        authorization: bearer(env),
        signal
      });
      const jobId = typeof created?.job?.id === "string" ? created.job.id : "";
      if (!DESIGN_ID_PATTERN.test(jobId)) throw new RangeError("Canva export job id is malformed");

      for (let poll = 0; poll < MAX_EXPORT_POLLS; poll += 1) {
        signal?.throwIfAborted();
        const payload = await request(context, {
          path: `/rest/v1/exports/${encodeURIComponent(jobId)}`,
          authorization: bearer(env),
          signal
        });
        const job = payload?.job ?? {};
        if (job.status === "success") {
          const urls = Array.isArray(job.urls) ? job.urls.filter(url => typeof url === "string") : [];
          if (!urls.length) throw new RangeError("Canva export finished without a file");
          return { jobId, format: type, urls };
        }
        if (job.status === "failed") {
          // The provider's reason is not forwarded: only the fact of a refusal.
          throw new RangeError("Canva export job failed");
        }
        await context.sleep(EXPORT_POLL_DELAY_MS);
      }
      throw new RangeError("Canva export job did not finish in time");
    }
  };
}

async function request(context, { path, method = "GET", search = {}, body = null, contentType = "", authorization, signal }) {
  if (typeof context.fetchImpl !== "function") {
    throw new TypeError("Canva adapter requires a fetch implementation");
  }
  if (!authorization) throw new RangeError(`Canva access token is not configured (${CANVA_TOKEN_ENV})`);

  const url = new URL(`${CANVA_API_ORIGIN}${path}`);
  for (const [name, value] of Object.entries(search)) url.searchParams.set(name, value);
  // Fails closed if a path or parameter ever pushed the request off api.canva.com.
  isAllowedProviderUrl(url.toString(), CANVA_API_HOSTS);

  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    const response = await fetchWithTimeout(context, url, { method, body, contentType, authorization }, signal);
    const status = Number(response?.status);

    if (response?.ok) {
      return readBoundedJson(response, context.maxResponseBytes, "Canva response");
    }

    // The error body is dropped unread: never inspected, never logged, never
    // forwarded — only the status survives.
    discardBody(response);

    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw providerError(status);
    await context.sleep(retryDelayMs(response, attempt));
  }
}

async function fetchWithTimeout(context, url, { method, body, contentType, authorization }, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("canva_request_timeout")), context.timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await context.fetchImpl(url.toString(), {
      method,
      headers: {
        authorization,
        accept: "application/json",
        ...(contentType ? { "content-type": contentType } : {})
      },
      ...(body === null ? {} : { body }),
      signal: controller.signal,
      redirect: "error"
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function normalizeDesign(raw) {
  const id = typeof raw?.id === "string" ? raw.id.trim() : "";
  if (!DESIGN_ID_PATTERN.test(id)) return null;
  const thumbnail = typeof raw?.thumbnail?.url === "string" ? raw.thumbnail.url : "";
  return {
    id,
    title: clampText(raw?.title, MAX_TITLE_CHARS),
    // Only an https thumbnail survives: anything else would be a link the board
    // renders without ever having checked it.
    thumbnailUrl: /^https:\/\//.test(thumbnail) ? thumbnail : "",
    updatedAt: Number.isSafeInteger(raw?.updated_at) ? raw.updated_at : null
  };
}

function normalizeTokens(payload) {
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new RangeError("Canva did not return an access token");
  return {
    accessToken,
    refreshToken: typeof payload?.refresh_token === "string" ? payload.refresh_token : "",
    expiresIn: Number.isSafeInteger(payload?.expires_in) ? payload.expires_in : null,
    scope: typeof payload?.scope === "string" ? payload.scope.slice(0, 500) : ""
  };
}

function providerError(status) {
  // The message carries the status and nothing from the provider: an upstream
  // body can contain anything, including the caller's own credentials.
  return Object.assign(new Error(`Canva request failed with status ${status || "unknown"}`), {
    statusCode: status === 429 ? 429 : status >= 500 ? 502 : 400
  });
}

function retryDelayMs(response, attempt) {
  const header = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_RETRY_AFTER_MS);
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function discardBody(response) {
  try {
    response?.body?.cancel?.();
  } catch { /* the socket is already gone */ }
}

function bearer(env) {
  const token = readToken(env);
  return token ? `Bearer ${token}` : "";
}

function readToken(env) {
  return typeof env?.[CANVA_TOKEN_ENV] === "string" ? env[CANVA_TOKEN_ENV].trim() : "";
}

function readClientId(env) {
  return typeof env?.[CANVA_CLIENT_ID_ENV] === "string" ? env[CANVA_CLIENT_ID_ENV].trim() : "";
}

function readClientSecret(env) {
  return typeof env?.[CANVA_CLIENT_SECRET_ENV] === "string" ? env[CANVA_CLIENT_SECRET_ENV].trim() : "";
}

function base64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function clampText(value, maxChars) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
