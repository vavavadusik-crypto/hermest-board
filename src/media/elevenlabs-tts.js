import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { assertSafeGeneratedPath } from "./ffmpeg-args.js";
import { readBoundedBytes, readBoundedJson } from "./bounded-body.js";
import { probeMediaFile } from "./process-runner.js";
import { normalizeNarrationLanguage, normalizeNarrationScript } from "./tts.js";

const ELEVENLABS_PROVIDER = "elevenlabs";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
// Premade multilingual voice (Rachel); overridable per request with any voice id.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;
const DEFAULT_MAX_CHARACTERS_PER_JOB = 10000;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_VOICE_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_VOICES_RETURNED = 120;
const MAX_SEED = 4294967295;
const REQUEST_TIMEOUT_MS = 120000;
const RETRY_DELAYS_MS = Object.freeze([500, 1500]);

export function resolveElevenLabsVoice(voice) {
  if (voice === undefined || voice === null || voice === "") return DEFAULT_VOICE_ID;
  if (typeof voice !== "string" || !VOICE_ID_PATTERN.test(voice)) {
    throw new TypeError("Unknown ElevenLabs voice id");
  }
  return voice;
}

export function describeElevenLabsAvailability({ env = process.env } = {}) {
  const key = typeof env.HERMEST_ELEVENLABS_API_KEY === "string"
    ? env.HERMEST_ELEVENLABS_API_KEY.trim()
    : "";
  return {
    provider: ELEVENLABS_PROVIDER,
    model: ELEVENLABS_MODEL,
    status: key ? "executable" : "missing_api_key"
  };
}

export function createElevenLabsNarrationAdapter(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const env = dependencies.env || process.env;
  const apiKeyProvider = dependencies.apiKeyProvider
    || (async () => (typeof env.HERMEST_ELEVENLABS_API_KEY === "string" ? env.HERMEST_ELEVENLABS_API_KEY.trim() : ""));
  const writeBytes = dependencies.writeBytes
    || ((filePath, bytes) => writeFile(filePath, bytes, { flag: "wx", mode: 0o600 }));
  const probeFile = dependencies.probeFile || probeMediaFile;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const maxCharactersPerJob =
    Number.isSafeInteger(dependencies.maxCharactersPerJob) && dependencies.maxCharactersPerJob > 0
      ? dependencies.maxCharactersPerJob
      : DEFAULT_MAX_CHARACTERS_PER_JOB;

  return Object.freeze({
    id: ELEVENLABS_PROVIDER,
    async synthesize({ text, language = "en", voice, outputPath, seed, signal } = {}) {
      signal?.throwIfAborted();
      const script = normalizeNarrationScript(text);
      const normalizedLanguage = normalizeNarrationLanguage(language);
      const outputFile = assertSafeGeneratedPath(outputPath);
      const voiceId = resolveElevenLabsVoice(voice);
      if (script.length > maxCharactersPerJob) {
        throw new RangeError(`Narration exceeds the ElevenLabs budget of ${maxCharactersPerJob} characters`);
      }
      const apiKey = String((await apiKeyProvider()) || "").trim();
      if (!apiKey) throw new RangeError("ElevenLabs API key is not configured");

      const requestBody = { text: script, model_id: ELEVENLABS_MODEL };
      if (seed !== undefined) {
        if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
          throw new RangeError(`ElevenLabs seed must be an integer in 0..${MAX_SEED}`);
        }
        requestBody.seed = seed;
      }

      const audio = await requestSynthesis({ fetchImpl, apiKey, voiceId, requestBody, sleep, signal });
      await writeBytes(outputFile, audio);
      signal?.throwIfAborted();
      const probe = await probeFile(outputFile, { signal });
      if (!probe?.audio) throw new TypeError("Narration output does not contain an audio stream");

      const metadata = {
        provider: ELEVENLABS_PROVIDER,
        model: ELEVENLABS_MODEL,
        voice: voiceId,
        language: normalizedLanguage,
        durationSeconds: Number(probe.durationSeconds),
        sampleRate: Number(probe.audio.sampleRate || 0),
        channels: Number(probe.audio.channels || 0),
        codec: String(probe.audio.codec || "unknown"),
        scriptSha256: createHash("sha256").update(script).digest("hex"),
        characterCount: script.length,
        warnings: [],
        command: null
      };
      if (requestBody.seed !== undefined) metadata.seed = requestBody.seed;
      return metadata;
    }
  });
}

/**
 * Каталог голосов аккаунта. Нужен, чтобы человек выбирал голос по имени, а не
 * вписывал двадцатисимвольный id руками. Ключ остаётся на стороне воркера:
 * наружу уходят только имя, id, язык и ссылка на превью самого провайдера.
 */
export async function listElevenLabsVoices({
  env = process.env,
  fetchImpl = globalThis.fetch,
  apiKeyProvider,
  signal
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("ElevenLabs catalogue requires a fetch implementation");
  }
  const readKey = apiKeyProvider
    || (async () => (typeof env.HERMEST_ELEVENLABS_API_KEY === "string" ? env.HERMEST_ELEVENLABS_API_KEY.trim() : ""));
  const apiKey = String((await readKey()) || "").trim();
  if (!apiKey) throw new RangeError("ElevenLabs API key is not configured");

  const response = await fetchCatalogue({ fetchImpl, apiKey, signal });
  if (!response.ok) {
    const status = Number(response.status);
    // Тело ответа провайдера не читаем и не пересказываем: в нём может лежать
    // эхо заголовков вместе с ключом.
    response.body?.cancel?.();
    if (status === 401 || status === 403) {
      throw new RangeError("ElevenLabs rejected the API key (invalid or missing permissions)");
    }
    throw new RangeError(`ElevenLabs voice catalogue failed with status ${status}`);
  }
  const payload = await readBoundedJson(response, MAX_VOICE_CATALOG_BYTES, "ElevenLabs voice catalogue");
  const raw = Array.isArray(payload?.voices) ? payload.voices : [];
  const voices = [];
  for (const entry of raw) {
    const id = typeof entry?.voice_id === "string" ? entry.voice_id : "";
    if (!VOICE_ID_PATTERN.test(id)) continue;
    const name = normalizeCatalogueText(entry?.name, 80);
    if (!name) continue;
    const previewUrl = typeof entry?.preview_url === "string" && entry.preview_url.startsWith("https://")
      ? entry.preview_url
      : "";
    voices.push({
      id,
      name,
      language: normalizeCatalogueText(entry?.labels?.language, 16),
      category: normalizeCatalogueText(entry?.category, 24),
      previewUrl
    });
    if (voices.length >= MAX_VOICES_RETURNED) break;
  }
  // Свои голоса вперёд: пользователь ищет то, что создал сам, а не витрину.
  voices.sort((left, right) => {
    const ownership = Number(left.category === "premade") - Number(right.category === "premade");
    return ownership !== 0 ? ownership : left.name.localeCompare(right.name, "ru");
  });
  return { provider: ELEVENLABS_PROVIDER, voices };
}

function normalizeCatalogueText(value, limit) {
  if (typeof value !== "string") return "";
  // Управляющие символы из чужого ответа не должны доехать до разметки.
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit);
}

async function fetchCatalogue({ fetchImpl, apiKey, signal }) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("ElevenLabs request timed out")),
    REQUEST_TIMEOUT_MS
  );
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetchImpl(`${ELEVENLABS_BASE_URL}/v1/voices`, {
      method: "GET",
      headers: { "xi-api-key": apiKey, accept: "application/json" },
      redirect: "error",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function requestSynthesis({ fetchImpl, apiKey, voiceId, requestBody, sleep, signal }) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("ElevenLabs adapter requires a fetch implementation");
  }
  const url = `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${voiceId}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    const response = await fetchWithTimeout({ fetchImpl, url, apiKey, requestBody, signal });
    if (response.ok) {
      const payload = await readBoundedBytes(response, MAX_AUDIO_BYTES, "ElevenLabs audio payload");
      if (payload.length === 0) throw new TypeError("ElevenLabs returned an empty audio payload");
      return payload;
    }
    const status = Number(response.status);
    if (status === 401 || status === 403) {
      throw new RangeError("ElevenLabs rejected the API key (invalid or missing permissions)");
    }
    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      throw new RangeError(`ElevenLabs request failed with status ${status}`);
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

async function fetchWithTimeout({ fetchImpl, url, apiKey, requestBody, signal }) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("ElevenLabs request timed out")),
    REQUEST_TIMEOUT_MS
  );
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
