// Text-модель поверх любого OpenAI-совместимого /chat/completions: платный ключ
// (OpenAI, Groq, Together, DeepSeek, Mistral, OpenRouter, HuggingFace) или
// бесплатный локальный Ollama без ключа. Один адаптер — десятки провайдеров.

import { readBoundedJson } from "./bounded-body.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODEL_CHARS = 128;
const REQUEST_TIMEOUT_MS = 180000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/u;

export const OPENAI_COMPATIBLE_PRESETS = Object.freeze({
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", requiresKey: true },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", requiresKey: true },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", requiresKey: true },
  deepseek: { label: "DeepSeek API", baseUrl: "https://api.deepseek.com", requiresKey: true },
  mistral: { label: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", requiresKey: true },
  huggingface: { label: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", requiresKey: true },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", requiresKey: true },
  ollama: { label: "Ollama (локально)", baseUrl: "http://127.0.0.1:11434/v1", requiresKey: false }
});

export function createOpenAiTextModel({ baseUrl, apiKey = "", model, fetchImpl = fetch } = {}) {
  const endpointUrl = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const resolvedModel = normalizeModel(model);
  const authorization = normalizeApiKey(apiKey);

  return {
    provider: "openai-compatible",
    model: resolvedModel,
    async complete({ system, prompt, signal, temperature } = {}) {
      const text = String(prompt ?? "").trim();
      if (!text) throw new RangeError("Text model prompt is required");
      const messages = [];
      if (system) messages.push({ role: "system", content: String(system) });
      messages.push({ role: "user", content: text });

      const headers = { "Content-Type": "application/json" };
      if (authorization) headers.Authorization = `Bearer ${authorization}`;

      const response = await fetchWithTimeout(fetchImpl, endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          stream: false,
          temperature: normalizeTemperature(temperature)
        }),
        signal
      }, REQUEST_TIMEOUT_MS);

      if (response.status === 401 || response.status === 403) {
        // Ключ не попадает ни в текст ошибки, ни в лог: наружу уходит только факт отказа.
        throw new RangeError("provider rejected the API key");
      }
      if (!response.ok) {
        throw new RangeError(`provider returned status ${response.status}`);
      }
      const payload = await readBoundedJson(response, MAX_RESPONSE_BYTES, "provider response");
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new RangeError("provider returned an empty completion");
      }
      return content;
    }
  };
}

// SSRF-guard: удалённый провайдер — только по https, http оставлен исключительно
// локальным рантаймам (Ollama), чтобы UI не мог направить запрос во внутреннюю сеть.
function normalizeBaseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\//i.test(raw)) {
    throw new RangeError("baseUrl must start with http:// or https://");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RangeError("baseUrl is not a valid URL");
  }
  if (parsed.protocol === "http:" && !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new RangeError("plain http baseUrl is allowed only for 127.0.0.1 or localhost");
  }
  return raw.replace(/\/+$/, "");
}

// Editions need deterministic translation (temperature 0); the historical
// default of 0.4 is preserved for every other caller.
function normalizeTemperature(value) {
  if (value === undefined || value === null) return 0.4;
  const temperature = Number(value);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new RangeError("temperature must be a number between 0 and 2");
  }
  return temperature;
}

function normalizeModel(value) {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model) throw new RangeError("model is required");
  if (model.length > MAX_MODEL_CHARS) {
    throw new RangeError(`model must be at most ${MAX_MODEL_CHARS} characters`);
  }
  if (CONTROL_CHARS_PATTERN.test(model)) throw new RangeError("model contains control characters");
  return model;
}

// Управляющие символы в ключе — это инъекция в заголовок Authorization;
// сам ключ в сообщении об ошибке не упоминается.
function normalizeApiKey(value) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (apiKey && CONTROL_CHARS_PATTERN.test(apiKey)) {
    throw new RangeError("apiKey contains control characters");
  }
  return apiKey;
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
  } finally {
    clearTimeout(timer);
    if (upstreamSignal) upstreamSignal.removeEventListener("abort", onAbort);
  }
}
