// Каталог голосов ElevenLabs. Ответ провайдера — недоверенный вход: из него в
// интерфейс попадают только проверенные поля, а ключ не должен просочиться ни в
// ответ, ни в текст ошибки.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { listElevenLabsVoices } from "../../src/media/elevenlabs-tts.js";
import { createLocalMediaJobManager } from "../../src/local-media/job-manager.js";
import { createLocalMediaRequestHandler } from "../../src/local-media/vite-plugin.js";

const KEY_ENV = { HERMEST_ELEVENLABS_API_KEY: "xi-secret-key" };

function jsonResponse(body, { status = 200 } = {}) {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async arrayBuffer() { return encoded.buffer.slice(0); },
    body: { cancel() {} }
  };
}

function recordingFetch(response) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  impl.calls = calls;
  return impl;
}

const CATALOGUE = {
  voices: [
    { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade", labels: { language: "en" }, preview_url: "https://cdn.example/r.mp3" },
    { voice_id: "UX4FA7ZvSPh1ma6rI8P9", name: "Aterna", category: "generated", labels: { language: "ru" }, preview_url: "https://cdn.example/a.mp3" },
    { voice_id: "../../etc/passwd", name: "Взлом", category: "generated" },
    { voice_id: "AbCdEfGhIjKlMnOpQrSt", name: "Плохое\u0007превью", category: "cloned", preview_url: "http://insecure.example/x.mp3" }
  ]
};

test("the catalogue keeps only voices whose id could be used, and trims their names", async () => {
  const fetchImpl = recordingFetch(jsonResponse(CATALOGUE));
  const { voices } = await listElevenLabsVoices({ env: KEY_ENV, fetchImpl });

  assert.equal(voices.length, 3, "запись с негодным id должна отсеяться");
  assert.equal(fetchImpl.calls[0].url, "https://api.elevenlabs.io/v1/voices");
  assert.equal(fetchImpl.calls[0].options.headers["xi-api-key"], "xi-secret-key");
  assert.equal(fetchImpl.calls[0].options.redirect, "error");

  // Свои голоса идут раньше витринных: человек ищет то, что создал сам.
  assert.equal(voices.at(-1).name, "Rachel", "витринный голос обязан оказаться последним");
  const aterna = voices.find(voice => voice.name === "Aterna");
  const trimmed = voices.find(voice => voice.name.startsWith("Плохое"));
  // Управляющий байт из чужого ответа не доезжает до разметки.
  assert.equal(trimmed.name, "Плохое превью");
  // Не-https превью — ссылка, которую никто не проверял, и она не отдаётся.
  assert.equal(trimmed.previewUrl, "");
  assert.equal(aterna.previewUrl, "https://cdn.example/a.mp3");
  assert.equal(aterna.language, "ru");
});

test("without a key nothing is sent at all", async () => {
  const fetchImpl = recordingFetch(jsonResponse(CATALOGUE));
  await assert.rejects(
    () => listElevenLabsVoices({ env: {}, fetchImpl }),
    /API key is not configured/u
  );
  assert.equal(fetchImpl.calls.length, 0, "запрос ушёл без ключа");
});

test("a rejected key is reported without echoing the provider's body", async () => {
  const fetchImpl = recordingFetch(jsonResponse({ detail: "xi-secret-key is invalid" }, { status: 401 }));
  await assert.rejects(() => listElevenLabsVoices({ env: KEY_ENV, fetchImpl }), error => {
    assert.ok(!error.message.includes("xi-secret-key"), "ключ утёк в сообщение об ошибке");
    assert.match(error.message, /rejected the API key/u);
    return true;
  });
});

test("a broken upstream status is surfaced as a status, not as prose", async () => {
  const fetchImpl = recordingFetch(jsonResponse({ message: "boom" }, { status: 503 }));
  await assert.rejects(() => listElevenLabsVoices({ env: KEY_ENV, fetchImpl }), /status 503/u);
});

async function startServer(t, overrides = {}) {
  const manager = createLocalMediaJobManager({ executeRender: async () => ({}) });
  const server = createServer(createLocalMediaRequestHandler({ manager, ...overrides }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function getVoices(origin, { provider = "elevenlabs", headers = { "x-hermest-local-media": "1" } } = {}) {
  return fetch(`${origin}/api/local-media/narration-voices?provider=${encodeURIComponent(provider)}`, { headers });
}

test("with no key configured the route answers with an empty catalogue, not an error", async t => {
  const origin = await startServer(t, {
    providerKeys: { listProviders: () => [{ id: "elevenlabs", configured: false }] },
    listNarrationVoices: async () => assert.fail("провайдер не должен вызываться без ключа")
  });
  const response = await getVoices(origin);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.configured, false);
  assert.deepEqual(payload.voices, []);
});

test("with a key the route returns the catalogue", async t => {
  const origin = await startServer(t, {
    providerKeys: { listProviders: () => [{ id: "elevenlabs", configured: true }] },
    listNarrationVoices: async () => ({ voices: [{ id: "UX4FA7ZvSPh1ma6rI8P9", name: "Aterna", language: "ru", category: "generated", previewUrl: "" }] })
  });
  const payload = await (await getVoices(origin)).json();
  assert.equal(payload.configured, true);
  assert.equal(payload.voices[0].name, "Aterna");
});

test("a provider failure becomes a code, never the provider's words", async t => {
  const origin = await startServer(t, {
    providerKeys: { listProviders: () => [{ id: "elevenlabs", configured: true }] },
    listNarrationVoices: async () => { throw new Error("xi-secret-key is invalid"); }
  });
  const response = await getVoices(origin);
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, "narration_voices_unavailable");
  assert.ok(!JSON.stringify(payload).includes("xi-secret-key"));
});

test("an unknown provider and a missing header are both refused", async t => {
  const origin = await startServer(t, {
    providerKeys: { listProviders: () => [{ id: "elevenlabs", configured: true }] },
    listNarrationVoices: async () => assert.fail("сервис не должен вызываться")
  });
  assert.equal((await getVoices(origin, { provider: "openai" })).status, 400);
  assert.ok((await getVoices(origin, { headers: {} })).status >= 400);
});
