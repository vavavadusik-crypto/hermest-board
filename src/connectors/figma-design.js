// Figma REST adapter. Every endpoint, header and parameter below was verified
// against the official documentation on 2026-07-26:
//   base URL + endpoints  https://developers.figma.com/docs/rest-api/
//   OpenAPI paths         https://github.com/figma/rest-api-spec
//                         (/v1/files/{file_key}, /v1/files/{file_key}/styles,
//                          /v1/images/{file_key})
//   token header          https://developers.figma.com/docs/rest-api/personal-access-tokens/
//                         ("The token is sent via X-Figma-Token header")
//   scopes                https://developers.figma.com/docs/rest-api/scopes/
//                         (file_content:read, library_content:read)
//   rate limits           https://developers.figma.com/docs/rest-api/rate-limits/
//                         (429 with a Retry-After header in seconds)
// The token is a server-side personal access token only. It is never accepted from
// a request body and never echoed back.
import { readBoundedJson } from "../media/bounded-body.js";
import { isAllowedProviderUrl, safeFetch, validateOutboundUrl } from "../media/ssrf-guard.js";

const FIGMA_PROVIDER = "figma";
const FIGMA_API_ORIGIN = "https://api.figma.com";
const FIGMA_API_HOSTS = Object.freeze(["api.figma.com"]);
const FIGMA_TOKEN_ENV = "FIGMA_ACCESS_TOKEN";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_NODE_IDS = 50;
const MAX_STYLES = 200;
const MAX_PAGES = 100;
const MAX_TEXT_CHARS = 200;
const MAX_DEPTH = 4;
const RETRY_DELAYS_MS = Object.freeze([500, 1500]);
const MAX_RETRY_AFTER_MS = 10000;

// Figma file keys are opaque alphanumeric strings in file URLs. Anything with a
// slash, dot or escape would let a caller steer the request path, so the key is
// validated before it ever reaches a URL.
const FILE_KEY_PATTERN = /^[A-Za-z0-9]{10,128}$/;
// Node ids look like "1:23" in the API and "1-23" in share URLs.
const NODE_ID_PATTERN = /^\d{1,10}[:-]\d{1,10}$/;
const IMAGE_FORMATS = new Set(["png", "jpg", "svg", "pdf"]);

export function describeFigmaAvailability({ env = process.env } = {}) {
  return {
    provider: FIGMA_PROVIDER,
    status: readToken(env) ? "executable" : "missing_access_token",
    tokenEnv: FIGMA_TOKEN_ENV,
    docs: "https://developers.figma.com/docs/rest-api/"
  };
}

export function normalizeFigmaFileKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!FILE_KEY_PATTERN.test(key)) throw new TypeError("Figma file key is malformed");
  return key;
}

export function normalizeFigmaNodeIds(value) {
  const list = Array.isArray(value) ? value : [value];
  const ids = [];
  for (const entry of list) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!NODE_ID_PATTERN.test(id)) throw new TypeError("Figma node id is malformed");
    // The REST API addresses nodes with a colon; share URLs use a dash.
    const normalized = id.replace("-", ":");
    if (!ids.includes(normalized)) ids.push(normalized);
  }
  if (ids.length === 0) throw new RangeError("At least one Figma node id is required");
  if (ids.length > MAX_NODE_IDS) {
    throw new RangeError(`No more than ${MAX_NODE_IDS} Figma node ids per request`);
  }
  return ids;
}

export function createFigmaDesignAdapter(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const lookup = dependencies.lookup;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeoutMs = positiveInteger(dependencies.timeoutMs, REQUEST_TIMEOUT_MS);
  const maxResponseBytes = positiveInteger(dependencies.maxResponseBytes, MAX_RESPONSE_BYTES);

  const context = { env, fetchImpl, lookup, sleep, timeoutMs, maxResponseBytes };

  return Object.freeze({
    id: FIGMA_PROVIDER,

    // Document summary only: page names and metadata, never the raw node tree, so
    // an oversized design cannot be pulled into a Board response wholesale.
    async importFile({ fileKey, depth = 1, signal } = {}) {
      const key = normalizeFigmaFileKey(fileKey);
      const requestedDepth = positiveInteger(depth, 1);
      if (requestedDepth > MAX_DEPTH) throw new RangeError(`Figma depth must be within 1..${MAX_DEPTH}`);

      const payload = await requestJson(
        context,
        `/v1/files/${key}`,
        { depth: String(requestedDepth) },
        signal
      );

      return {
        provider: FIGMA_PROVIDER,
        fileKey: key,
        name: text(payload?.name),
        lastModified: text(payload?.lastModified),
        version: text(payload?.version),
        editorType: text(payload?.editorType),
        thumbnailUrl: publicUrlOrNull(payload?.thumbnailUrl),
        pages: pageSummaries(payload?.document)
      };
    },

    // Published styles are the brand surface of a library file: fills, text styles,
    // effects and grids.
    async readBrandAssets({ fileKey, signal } = {}) {
      const key = normalizeFigmaFileKey(fileKey);
      const payload = await requestJson(context, `/v1/files/${key}/styles`, {}, signal);
      const styles = Array.isArray(payload?.meta?.styles) ? payload.meta.styles : [];

      return {
        provider: FIGMA_PROVIDER,
        fileKey: key,
        styles: styles.slice(0, MAX_STYLES).map(style => ({
          key: text(style?.key),
          name: text(style?.name),
          styleType: text(style?.style_type ?? style?.styleType),
          description: text(style?.description)
        }))
      };
    },

    // Render links are short-lived Figma-hosted URLs; they are validated as public
    // HTTPS targets before they are handed to any downloader.
    async renderNodeImages({ fileKey, nodeIds, format = "png", scale = 2, signal } = {}) {
      const key = normalizeFigmaFileKey(fileKey);
      const ids = normalizeFigmaNodeIds(nodeIds);
      const imageFormat = String(format || "png").toLowerCase();
      if (!IMAGE_FORMATS.has(imageFormat)) {
        throw new TypeError(`Figma image format must be one of ${[...IMAGE_FORMATS].join(", ")}`);
      }
      const imageScale = Number(scale);
      if (!Number.isFinite(imageScale) || imageScale < 0.01 || imageScale > 4) {
        throw new RangeError("Figma image scale must be a number within 0.01..4");
      }

      const payload = await requestJson(
        context,
        `/v1/images/${key}`,
        { ids: ids.join(","), format: imageFormat, scale: String(imageScale) },
        signal
      );

      const rendered = payload?.images && typeof payload.images === "object" ? payload.images : {};
      const images = [];
      const failed = [];
      for (const nodeId of ids) {
        const url = publicUrlOrNull(rendered[nodeId]);
        if (url) images.push({ nodeId, url });
        else failed.push(nodeId);
      }

      return { provider: FIGMA_PROVIDER, fileKey: key, format: imageFormat, scale: imageScale, images, failed };
    }
  });
}

async function requestJson(context, path, searchParams, signal) {
  if (typeof context.fetchImpl !== "function") {
    throw new TypeError("Figma adapter requires a fetch implementation");
  }
  const token = readToken(context.env);
  if (!token) throw new RangeError(`Figma access token is not configured (${FIGMA_TOKEN_ENV})`);

  const url = new URL(`${FIGMA_API_ORIGIN}${path}`);
  for (const [name, value] of Object.entries(searchParams)) url.searchParams.set(name, value);
  // Fails closed if a path or parameter ever pushed the request off api.figma.com.
  isAllowedProviderUrl(url.toString(), FIGMA_API_HOSTS);

  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    const response = await fetchWithTimeout(context, url, token, signal);
    const status = Number(response?.status);

    if (response?.ok) {
      return readBoundedJson(response, context.maxResponseBytes, "Figma response");
    }

    // The error body is dropped unread: it is never inspected, never logged and
    // never forwarded, and the socket is not left holding it.
    discardBody(response);

    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw providerError(status);
    // Documented 429 contract: Retry-After in seconds. Capped so a hostile or
    // mistaken header cannot park a request for minutes.
    await context.sleep(retryDelayMs(response, attempt));
  }
}

async function fetchWithTimeout(context, url, token, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("figma_request_timeout")), context.timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await safeFetch(
      url.toString(),
      {
        method: "GET",
        headers: { "X-Figma-Token": token, accept: "application/json" },
        signal: controller.signal
      },
      { fetchImpl: context.fetchImpl, lookup: context.lookup }
    );
  } catch (error) {
    if (error?.name === "AbortError" || error?.message === "figma_request_timeout") {
      signal?.throwIfAborted();
      throw new RangeError("Figma request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// Provider response bodies never leave this module: callers learn that Figma
// refused and which class of refusal it was, nothing more.
function providerError(status) {
  if (status === 401 || status === 403) {
    return new RangeError("Figma rejected the access token (invalid, expired or missing scope)");
  }
  if (status === 404) {
    return new RangeError("Figma file was not found or the token cannot access it");
  }
  if (status === 429) return new RangeError("Figma rate limit reached");
  return new RangeError(`Figma request failed with status ${Number.isFinite(status) ? status : "unknown"}`);
}

function discardBody(response) {
  try {
    response?.body?.cancel?.();
  } catch (_) {
    // A body that cannot be cancelled is already unusable; nothing to recover.
  }
}

function retryDelayMs(response, attempt) {
  const header = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header * 1000, MAX_RETRY_AFTER_MS);
  }
  return RETRY_DELAYS_MS[attempt];
}

function readToken(env) {
  const source = env && typeof env === "object" ? env : {};
  const token = typeof source[FIGMA_TOKEN_ENV] === "string" ? source[FIGMA_TOKEN_ENV].trim() : "";
  return token;
}

function pageSummaries(document) {
  const children = Array.isArray(document?.children) ? document.children : [];
  return children
    .filter(child => child?.type === "CANVAS")
    .slice(0, MAX_PAGES)
    .map(page => ({ id: text(page?.id), name: text(page?.name) }));
}

function publicUrlOrNull(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    return validateOutboundUrl(value).toString();
  } catch {
    return null;
  }
}

function text(value) {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_CHARS) : "";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    if (value === undefined || value === null) return fallback;
    throw new RangeError("Expected a positive integer");
  }
  return number;
}
