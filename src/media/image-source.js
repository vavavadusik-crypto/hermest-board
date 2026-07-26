import { createHash } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";

import { assertSafeGeneratedPath } from "./ffmpeg-args.js";
import { readBoundedBytes, readBoundedJson } from "./bounded-body.js";

const PRIVATE_FILE_MODE = 0o600;
const FAL_SYNC_URL = "https://fal.run/fal-ai/flux/schnell";
const FAL_MODEL = "fal-ai/flux/schnell";
const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";
const POLLINATIONS_MODEL = "flux";
const MAX_POLLINATIONS_PROMPT_CHARS = 800;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_PROMPT_CHARS = 1200;
const MAX_DIMENSION = 2048;
const REQUEST_TIMEOUT_MS = 90000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export const TRANSIENT_IMAGE_ERROR_CODE = "IMAGE_SOURCE_TRANSIENT";
// Бесплатные генераторы отвечают 5xx и 429 под нагрузкой чаще, чем платные.
// Без повтора одна такая осечка молча роняет сцену на следующий источник
// каскада, и качество картинки падает без причины, видимой человеку.
export const IMAGE_RETRY_DELAYS_MS = Object.freeze([400, 1200]);

export function describeImageSourceAvailability({ env = process.env } = {}) {
  // Pollinations — бесплатная генерация без ключа, поэтому источник картинок
  // доступен всегда; платные fal/pexels лишь расширяют список провайдеров.
  const providers = [];
  if (readFalKey(env)) providers.push("fal");
  providers.push("pollinations");
  if (readPexelsKey(env)) providers.push("pexels-photos");
  return { status: "executable", providers };
}

// Каскад по умолчанию: платная генерация первой (если ключ есть), бесплатная
// генерация Pollinations всегда следом как надёжный fallback, сток последним;
// каждый источник fail-open к следующему с честным warning.
// Настроен ли платный источник картинок (FAL/Pexels). Бесплатный Pollinations
// сюда не входит: он всегда доступен, но включается только явным opt-in проекта,
// чтобы рендеры по умолчанию оставались детерминированными и без сети.
export function hasKeyedImageProvider(env = process.env) {
  return Boolean(readFalKey(env) || readPexelsKey(env));
}

export function createDefaultImageSourceCascade({ env = process.env, fetchImpl = fetch, onWarning } = {}) {
  const adapters = [];
  if (readFalKey(env)) adapters.push(createFalImageAdapter({ env, fetchImpl }));
  adapters.push(createPollinationsImageAdapter({ fetchImpl }));
  if (readPexelsKey(env)) adapters.push(createPexelsImageAdapter({ env, fetchImpl }));
  return createImageSourceCascade(adapters.map(adapter => withTransientRetry(adapter, { onWarning })), { onWarning });
}

/**
 * Повторяет запрос к источнику картинок только на временных отказах провайдера
 * (5xx, 429, сетевой обрыв, свой таймаут). Отказ по ключу, неверный запрос или
 * отмена задачи человеком повторов не получают: они не пройдут и со второй
 * попытки, а отмена обязана оставаться мгновенной.
 */
export function withTransientRetry(adapter, {
  delaysMs = IMAGE_RETRY_DELAYS_MS,
  onWarning,
  sleep = defaultSleep
} = {}) {
  const delays = Array.isArray(delaysMs) ? delaysMs.filter(delay => Number.isFinite(delay) && delay >= 0) : [];
  return {
    ...adapter,
    async generateImage(request) {
      let lastError = null;
      for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        try {
          return await adapter.generateImage(request);
        } catch (error) {
          lastError = error;
          const isLastAttempt = attempt === delays.length;
          if (request?.signal?.aborted || error?.code !== TRANSIENT_IMAGE_ERROR_CODE || isLastAttempt) throw error;
          onWarning?.(
            `image source ${adapter.provider} hit a transient failure (${error.message}), retry ${attempt + 1} of ${delays.length}`
          );
          await sleep(delays[attempt]);
        }
      }
      throw lastError;
    }
  };
}

export function createFalImageAdapter({ env = process.env, fetchImpl = fetch } = {}) {
  return {
    provider: "fal",
    model: FAL_MODEL,
    async generateImage({ prompt, stylePreset, width, height, seed, outputPath, signal }) {
      const apiKey = readFalKey(env);
      if (!apiKey) throw new RangeError("FAL API key is not configured");
      const fullPrompt = composePrompt(prompt, stylePreset);
      const safeWidth = imageDimension(width, "width");
      const safeHeight = imageDimension(height, "height");
      const safeOutputPath = assertSafeGeneratedPath(outputPath);
      const requestBody = {
        prompt: fullPrompt,
        image_size: { width: safeWidth, height: safeHeight },
        num_images: 1
      };
      if (seed !== undefined) {
        const safeSeed = Number(seed);
        if (!Number.isSafeInteger(safeSeed) || safeSeed < 0) {
          throw new RangeError("seed must be a non-negative integer");
        }
        requestBody.seed = safeSeed;
      }

      const response = await fetchWithTimeout(fetchImpl, FAL_SYNC_URL, {
        method: "POST",
        headers: {
          Authorization: `Key ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal
      }, REQUEST_TIMEOUT_MS);
      if (response.status === 401 || response.status === 403) {
        throw new RangeError("FAL rejected the API key");
      }
      if (!response.ok) {
        throw httpFailure("FAL generation", response.status);
      }
      const payload = await readBoundedJson(response, MAX_RESPONSE_BYTES, "FAL response");
      const image = Array.isArray(payload?.images) ? payload.images[0] : null;
      if (!image) throw new RangeError("FAL returned no image");
      const imageUrl = typeof image.url === "string" ? image.url : "";
      if (!imageUrl.startsWith("https://")) throw new RangeError("FAL returned an unsafe image url");

      const imageResponse = await fetchWithTimeout(fetchImpl, imageUrl, { signal }, DOWNLOAD_TIMEOUT_MS);
      if (!imageResponse.ok) {
        throw httpFailure("FAL image download", imageResponse.status);
      }
      const imageBytes = await readBoundedBytes(imageResponse, MAX_IMAGE_BYTES, "FAL image");
      if (imageBytes.length === 0) {
        throw new RangeError("FAL image size is outside the allowed range");
      }
      if (!hasImageMagic(imageBytes)) {
        throw new RangeError("FAL response is not a supported image format");
      }
      await writeFile(safeOutputPath, imageBytes, { flag: "wx", mode: PRIVATE_FILE_MODE });
      await chmod(safeOutputPath, PRIVATE_FILE_MODE);
      return {
        path: safeOutputPath,
        sha256: createHash("sha256").update(imageBytes).digest("hex"),
        bytes: imageBytes.length,
        width: Number(image.width) || safeWidth,
        height: Number(image.height) || safeHeight,
        license: "fal-generated",
        provenance: {
          source: "generated",
          provider: "fal",
          model: FAL_MODEL,
          promptSha256: createHash("sha256").update(fullPrompt).digest("hex"),
          ...(requestBody.seed !== undefined ? { seed: requestBody.seed } : {})
        }
      };
    }
  };
}

// Бесплатная генерация без ключа: главная ценность — доступна всегда, поэтому
// стоит в каскаде между платным FAL и стоковым Pexels как надёжный fallback.
export function createPollinationsImageAdapter({ fetchImpl = fetch } = {}) {
  return {
    provider: "pollinations",
    model: POLLINATIONS_MODEL,
    async generateImage({ prompt, stylePreset, width, height, seed, outputPath, signal }) {
      const fullPrompt = composePrompt(prompt, stylePreset);
      const safeWidth = imageDimension(width, "width");
      const safeHeight = imageDimension(height, "height");
      const safeOutputPath = assertSafeGeneratedPath(outputPath);
      // Промпт идёт в путь URL — без encodeURIComponent это инъекция пути.
      const promptSegment = encodeURIComponent(fullPrompt.slice(0, MAX_POLLINATIONS_PROMPT_CHARS));

      const url = new URL(`${POLLINATIONS_BASE}/${promptSegment}`);
      url.searchParams.set("width", String(safeWidth));
      url.searchParams.set("height", String(safeHeight));
      url.searchParams.set("nologo", "true");
      url.searchParams.set("model", POLLINATIONS_MODEL);
      let safeSeed;
      if (seed !== undefined) {
        safeSeed = Number(seed);
        if (!Number.isSafeInteger(safeSeed) || safeSeed < 0) {
          throw new RangeError("seed must be a non-negative integer");
        }
        url.searchParams.set("seed", String(safeSeed));
      }

      const response = await fetchWithTimeout(fetchImpl, url.href, { signal }, DOWNLOAD_TIMEOUT_MS);
      if (!response.ok) {
        throw httpFailure("Pollinations generation", response.status);
      }
      const imageBytes = await readBoundedBytes(response, MAX_IMAGE_BYTES, "Pollinations image");
      if (imageBytes.length === 0 || !hasImageMagic(imageBytes)) {
        throw new RangeError("Pollinations response is not a supported image format");
      }
      await writeFile(safeOutputPath, imageBytes, { flag: "wx", mode: PRIVATE_FILE_MODE });
      await chmod(safeOutputPath, PRIVATE_FILE_MODE);
      return {
        path: safeOutputPath,
        sha256: createHash("sha256").update(imageBytes).digest("hex"),
        bytes: imageBytes.length,
        width: safeWidth,
        height: safeHeight,
        license: "pollinations-generated",
        provenance: {
          source: "generated",
          provider: "pollinations",
          model: POLLINATIONS_MODEL,
          promptSha256: createHash("sha256").update(fullPrompt).digest("hex"),
          ...(seed !== undefined ? { seed: safeSeed } : {})
        }
      };
    }
  };
}

const PEXELS_PHOTO_SEARCH_URL = "https://api.pexels.com/v1/search";
const MAX_KEYWORDS_CHARS = 120;

export function createPexelsImageAdapter({ env = process.env, fetchImpl = fetch } = {}) {
  return {
    provider: "pexels-photos",
    async generateImage({ prompt, width, height, outputPath, signal }) {
      const apiKey = typeof env.HERMEST_PEXELS_API_KEY === "string" ? env.HERMEST_PEXELS_API_KEY.trim() : "";
      if (!apiKey) throw new RangeError("Pexels API key is not configured");
      const keywords = String(prompt ?? "").replace(/[^\p{L}\p{N} -]/gu, " ").replace(/\s+/g, " ").trim();
      if (!keywords) throw new RangeError("Image prompt is required");
      const safeWidth = imageDimension(width, "width");
      const safeHeight = imageDimension(height, "height");
      const safeOutputPath = assertSafeGeneratedPath(outputPath);

      const url = new URL(PEXELS_PHOTO_SEARCH_URL);
      url.searchParams.set("query", keywords.slice(0, MAX_KEYWORDS_CHARS));
      url.searchParams.set("orientation", safeHeight > safeWidth ? "portrait" : "landscape");
      url.searchParams.set("per_page", "10");
      const searchResponse = await fetchWithTimeout(fetchImpl, url.href, {
        headers: { Authorization: apiKey },
        signal
      }, REQUEST_TIMEOUT_MS);
      if (searchResponse.status === 401 || searchResponse.status === 403) {
        throw new RangeError("Pexels rejected the API key");
      }
      if (!searchResponse.ok) {
        throw httpFailure("Pexels photo search", searchResponse.status);
      }
      const payload = await readBoundedJson(searchResponse, MAX_RESPONSE_BYTES, "Pexels response");
      const photo = selectPexelsPhoto(payload, { width: safeWidth, height: safeHeight });
      if (!photo) throw new RangeError("Pexels returned no photo for the scene");
      if (!photo.fileUrl.startsWith("https://")) throw new RangeError("Pexels returned an unsafe image url");

      const imageResponse = await fetchWithTimeout(fetchImpl, photo.fileUrl, { signal }, DOWNLOAD_TIMEOUT_MS);
      if (!imageResponse.ok) {
        throw httpFailure("Pexels photo download", imageResponse.status);
      }
      const imageBytes = await readBoundedBytes(imageResponse, MAX_IMAGE_BYTES, "Pexels photo");
      if (imageBytes.length === 0 || !hasImageMagic(imageBytes)) {
        throw new RangeError("Pexels response is not a supported image format");
      }
      await writeFile(safeOutputPath, imageBytes, { flag: "wx", mode: PRIVATE_FILE_MODE });
      await chmod(safeOutputPath, PRIVATE_FILE_MODE);
      return {
        path: safeOutputPath,
        sha256: createHash("sha256").update(imageBytes).digest("hex"),
        bytes: imageBytes.length,
        width: photo.width,
        height: photo.height,
        license: "pexels",
        provenance: {
          source: "stock",
          provider: "pexels-photos",
          photoId: photo.photoId,
          author: photo.author,
          url: photo.pageUrl
        }
      };
    }
  };
}

function selectPexelsPhoto(payload, { width, height }) {
  const photos = Array.isArray(payload?.photos) ? payload.photos : [];
  const candidates = [];
  for (const photo of photos) {
    const source = photo?.src && typeof photo.src === "object" ? photo.src : {};
    const fileUrl = typeof source.original === "string" ? source.original : "";
    const photoWidth = Number(photo?.width);
    const photoHeight = Number(photo?.height);
    if (!fileUrl || !Number.isFinite(photoWidth) || !Number.isFinite(photoHeight)) continue;
    candidates.push({
      photoId: String(photo?.id ?? ""),
      author: String(photo?.photographer ?? ""),
      pageUrl: typeof photo?.url === "string" ? photo.url : "",
      fileUrl,
      width: photoWidth,
      height: photoHeight,
      // покрытие целевого кадра: фото должно закрывать обе стороны
      coverage: Math.min(photoWidth / width, photoHeight / height)
    });
  }
  candidates.sort((left, right) => right.coverage - left.coverage);
  return candidates[0] || null;
}

export function createImageSourceCascade(adapters, { onWarning } = {}) {
  const chain = (Array.isArray(adapters) ? adapters : []).filter(Boolean);
  if (chain.length === 0) throw new RangeError("Image source cascade requires at least one adapter");
  return {
    provider: chain.map(adapter => adapter.provider).join("+"),
    async generateImage(request) {
      let lastError = null;
      for (const adapter of chain) {
        try {
          return await adapter.generateImage(request);
        } catch (error) {
          lastError = error;
          onWarning?.(`image source ${adapter.provider} failed: ${error.message}`);
        }
      }
      throw lastError;
    }
  };
}

function composePrompt(prompt, stylePreset) {
  const scene = typeof prompt === "string" ? prompt.replace(/\s+/g, " ").trim() : "";
  if (!scene) throw new RangeError("Image prompt is required");
  const style = typeof stylePreset === "string" ? stylePreset.replace(/\s+/g, " ").trim() : "";
  const combined = style ? `${style}, ${scene}` : scene;
  return combined.slice(0, MAX_PROMPT_CHARS);
}

function imageDimension(value, name) {
  const dimension = Number(value);
  if (!Number.isSafeInteger(dimension) || dimension <= 0 || dimension > MAX_DIMENSION) {
    throw new RangeError(`${name} must be within 1..${MAX_DIMENSION}`);
  }
  return dimension;
}

function transientError(message) {
  const error = new RangeError(message);
  error.code = TRANSIENT_IMAGE_ERROR_CODE;
  return error;
}

// 5xx — провайдер лежит, 429 — просит подождать: и то и другое проходит со
// второй попытки. Остальные коды означают, что запрос неверен сам по себе.
function httpFailure(label, status) {
  const message = `${label} failed with status ${status}`;
  return status >= 500 || status === 429 ? transientError(message) : new RangeError(message);
}

function defaultSleep(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function hasImageMagic(bytes) {
  return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
    || bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
}

function readFalKey(env) {
  return typeof env.HERMEST_FAL_API_KEY === "string" ? env.HERMEST_FAL_API_KEY.trim() : "";
}

function readPexelsKey(env) {
  return typeof env.HERMEST_PEXELS_API_KEY === "string" ? env.HERMEST_PEXELS_API_KEY.trim() : "";
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = options.signal;
  const onAbort = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    // Отмена человеком обязана остаться отменой; всё остальное — обрыв сети
    // или наш собственный таймаут, а это лечится повторной попыткой.
    if (upstreamSignal?.aborted) throw error;
    throw transientError(`image source request failed: ${error?.message || "network error"}`);
  } finally {
    clearTimeout(timer);
    if (upstreamSignal) upstreamSignal.removeEventListener("abort", onAbort);
  }
}

