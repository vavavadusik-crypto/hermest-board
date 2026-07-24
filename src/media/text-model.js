// Text-модель поверх browser-ai-bridge: браузерный веб-чат (ChatGPT и др.)
// как OpenAI-совместимый бэкенд. Ключей нет — «ключом» служит живая
// залогиненная вкладка Chrome на стороне моста.

import { request as httpRequest } from "node:http";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8788/v1";
const REQUEST_TIMEOUT_MS = 480000; // reasoning-веб-чаты думают минутами — осознанная цена
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_HEALTH_BYTES = 64 * 1024;
const BRIDGE_MODEL_PATTERN = /^[a-z0-9-]{1,32}$/;

function bridgeBaseUrl(env) {
  const configured = typeof env.HERMEST_BRIDGE_URL === "string" ? env.HERMEST_BRIDGE_URL.trim() : "";
  const url = configured || DEFAULT_BRIDGE_URL;
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/v1$/.test(url)) {
    throw new RangeError("HERMEST_BRIDGE_URL must point at a local /v1 bridge endpoint");
  }
  return url;
}

export async function describeBridgeAvailability({ env = process.env, fetchImpl = fetch } = {}) {
  let baseUrl;
  try {
    baseUrl = bridgeBaseUrl(env);
  } catch (error) {
    return { status: "missing", provider: "browser-bridge", reason: error.message, providers: [] };
  }
  try {
    const response = await fetchWithTimeout(fetchImpl, `${new URL(baseUrl).origin}/health`, {}, 5000);
    if (!response.ok) {
      return {
        status: "missing",
        provider: "browser-bridge",
        reason: `bridge health returned ${response.status}`,
        providers: []
      };
    }
    // Список провайдеров — подсказка для UI, а не условие доступности:
    // мост жив по HTTP 200, даже если тело нечитаемо.
    return { status: "executable", provider: "browser-bridge", providers: await readHealthProviders(response) };
  } catch {
    return {
      status: "missing",
      provider: "browser-bridge",
      reason: "browser-ai-bridge is not running; start it in workspace/browser-ai-bridge (npm start)",
      providers: []
    };
  }
}

export function createBridgeTextModel({ env = process.env, model, postImpl = postJsonOverHttp } = {}) {
  const baseUrl = bridgeBaseUrl(env);
  const resolvedModel = resolveBridgeModel(env, model);
  return {
    provider: "browser-bridge",
    model: resolvedModel,
    async complete({ system, prompt, signal, temperature } = {}) {
      const text = String(prompt ?? "").trim();
      if (!text) throw new RangeError("Text model prompt is required");
      const messages = [];
      if (system) messages.push({ role: "system", content: String(system) });
      messages.push({ role: "user", content: text });
      // Web-chat backends may ignore temperature, but deterministic callers
      // (edition translation) still declare 0 so the intent travels with the request.
      const options = { stableTicks: 8, timeoutMs: 420000, requireJson: true };
      if (temperature !== undefined && temperature !== null) {
        const value = Number(temperature);
        if (!Number.isFinite(value) || value < 0 || value > 2) {
          throw new RangeError("temperature must be a number between 0 and 2");
        }
        options.temperature = value;
      }
      // stableTicks/requireJson: reasoning-модели прячут стоп-кнопку в паузах —
      // финал подтверждается только распарсенным JSON, а не «стабильной» тишиной.
      // Транспорт — node:http: встроенный fetch (undici) рвёт ожидание заголовков
      // на ~300s, а reasoning-веб-чат легально думает дольше.
      const response = await postImpl(`${baseUrl}/chat/completions`, {
        model: resolvedModel,
        messages,
        options
      }, { timeoutMs: REQUEST_TIMEOUT_MS, signal });
      if (!response.ok) {
        throw new RangeError(`browser bridge completion failed with status ${response.status}`);
      }
      const body = response.body;
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        throw new RangeError("browser bridge response exceeds the allowed size");
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new RangeError("browser bridge response is not valid JSON");
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new RangeError("browser bridge returned an empty completion");
      }
      return content;
    }
  };
}

// Провайдера валидирует сам мост, но произвольная строка из UI не должна
// попадать в тело запроса: пускаем только короткий kebab-case идентификатор.
function resolveBridgeModel(env, explicitModel) {
  const fromEnv = typeof env.HERMEST_BRIDGE_MODEL === "string" ? env.HERMEST_BRIDGE_MODEL.trim() : "";
  const requested = typeof explicitModel === "string" && explicitModel.trim()
    ? explicitModel.trim()
    : fromEnv || "chatgpt";
  const normalized = requested.toLowerCase();
  if (!BRIDGE_MODEL_PATTERN.test(normalized)) {
    throw new RangeError("invalid bridge model");
  }
  return normalized;
}

async function readHealthProviders(response) {
  const declaredBytes = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_HEALTH_BYTES) return [];
  try {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_HEALTH_BYTES) return [];
    const providers = JSON.parse(body)?.providers;
    if (!Array.isArray(providers) || providers.some(item => typeof item !== "string")) return [];
    return providers;
  } catch {
    return [];
  }
}

function postJsonOverHttp(url, payload, { timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = httpRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, response => {
      const chunks = [];
      let received = 0;
      response.on("data", chunk => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          request.destroy(new RangeError("browser bridge response exceeds the allowed size"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
      response.on("error", reject);
    });
    const timer = setTimeout(() => {
      request.destroy(new RangeError(`browser bridge completion timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onAbort = () => request.destroy(new RangeError("browser bridge completion aborted"));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    request.on("close", () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    });
    request.on("error", reject);
    request.end(body);
  });
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
