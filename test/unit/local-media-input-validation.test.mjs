import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createLocalMediaJobManager } from "../../src/local-media/job-manager.js";
import { createLocalMediaRequestHandler } from "../../src/local-media/vite-plugin.js";

async function startHandler(t, options) {
  const server = createServer(createLocalMediaRequestHandler(options));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  return origin;
}

function trackingDraftManager(submitted) {
  return {
    submit(params) {
      submitted.push(params);
      return { id: "draft_ok", status: "queued", board: null, warnings: [], error: null };
    },
    get: () => null,
    cancel: () => false
  };
}

function trackingRenderManager(submitted) {
  return {
    submit(params) {
      submitted.push(params);
      return { id: "job_ok", status: "queued", artifacts: [] };
    },
    get: () => null,
    cancel: () => false,
    resolveArtifact() { throw new RangeError("none"); }
  };
}

async function postJson(origin, route, payload) {
  return fetch(`${origin}/api/local-media/${route}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-hermest-local-media": "1" },
    body: JSON.stringify(payload)
  });
}

async function expectRejected(response, code) {
  assert.equal(response.status, 400, `expected 400 for ${code}`);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, code, `expected code ${code}, got ${JSON.stringify(body)}`);
  assert.equal(typeof body.error, "string");
  return body;
}

test("draft route rejects a missing, blank or malformed topic before the manager", async t => {
  const submitted = [];
  const origin = await startHandler(t, {
    manager: createLocalMediaJobManager({ executeRender: async () => ({}) }),
    draftManager: trackingDraftManager(submitted)
  });

  await expectRejected(await postJson(origin, "draft", {}), "draft_topic_required");
  await expectRejected(await postJson(origin, "draft", { topic: "   " }), "draft_topic_required");
  await expectRejected(await postJson(origin, "draft", { topic: 123 }), "draft_topic_invalid");
  await expectRejected(
    await postJson(origin, "draft", { topic: "x".repeat(2001) }),
    "draft_topic_invalid"
  );
  assert.equal(submitted.length, 0, "invalid drafts must never reach the manager");
});

test("draft route rejects malformed optional fields with specific codes", async t => {
  const submitted = [];
  const origin = await startHandler(t, {
    manager: createLocalMediaJobManager({ executeRender: async () => ({}) }),
    draftManager: trackingDraftManager(submitted)
  });
  const topic = "Валидная тема";

  await expectRejected(await postJson(origin, "draft", { topic, language: 42 }), "draft_language_invalid");
  await expectRejected(
    await postJson(origin, "draft", { topic, language: "x".repeat(33) }),
    "draft_language_invalid"
  );
  await expectRejected(await postJson(origin, "draft", { topic, voice: {} }), "draft_voice_invalid");
  await expectRejected(
    await postJson(origin, "draft", { topic, narrationProvider: 7 }),
    "draft_narration_provider_invalid"
  );
  await expectRejected(await postJson(origin, "draft", { topic, model: ["a"] }), "draft_model_invalid");
  await expectRejected(
    await postJson(origin, "draft", { topic, model: "x".repeat(65) }),
    "draft_model_invalid"
  );
  await expectRejected(await postJson(origin, "draft", { topic, sceneCount: "6" }), "draft_scene_count_invalid");
  await expectRejected(
    await postJson(origin, "draft", { topic, sceneCount: { evil: true } }),
    "draft_scene_count_invalid"
  );
  await expectRejected(await postJson(origin, "draft", { topic, research: "yes" }), "draft_research_invalid");
  assert.equal(submitted.length, 0);
});

test("draft route validates the target duration at the HTTP boundary", async t => {
  const submitted = [];
  const origin = await startHandler(t, {
    manager: createLocalMediaJobManager({ executeRender: async () => ({}) }),
    draftManager: trackingDraftManager(submitted)
  });
  const topic = "Валидная тема";

  for (const targetDurationSeconds of ["60", 14, 3601, 0, -60, true, { seconds: 60 }, [60]]) {
    await expectRejected(
      await postJson(origin, "draft", { topic, targetDurationSeconds }),
      "draft_target_duration_invalid"
    );
  }
  // JSON не умеет Infinity как литерал, зато 1e999 парсится именно в него.
  const infinite = await fetch(`${origin}/api/local-media/draft`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-hermest-local-media": "1" },
    body: `{"topic":"${topic}","targetDurationSeconds":1e999}`
  });
  await expectRejected(infinite, "draft_target_duration_invalid");
  assert.equal(submitted.length, 0, "invalid durations must never reach the manager");

  const accepted = await postJson(origin, "draft", { topic, targetDurationSeconds: 155 });
  assert.equal(accepted.status, 202);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].targetDurationSeconds, 155);

  // Прежнее поведение без цели длительности: поле просто отсутствует.
  await postJson(origin, "draft", { topic });
  assert.equal(submitted[1].targetDurationSeconds, undefined);
});

test("draft route rejects malformed endpoints and never echoes the api key", async t => {
  const submitted = [];
  const origin = await startHandler(t, {
    manager: createLocalMediaJobManager({ executeRender: async () => ({}) }),
    draftManager: trackingDraftManager(submitted)
  });
  const topic = "Валидная тема";
  const secret = "sk-super-secret-value-123";

  await expectRejected(await postJson(origin, "draft", { topic, endpoint: "openai" }), "draft_endpoint_invalid");
  await expectRejected(
    await postJson(origin, "draft", { topic, endpoint: { kind: "carrier-pigeon" } }),
    "draft_endpoint_invalid"
  );
  const echoed = await expectRejected(
    await postJson(origin, "draft", {
      topic,
      endpoint: { kind: "openai", baseUrl: 42, apiKey: secret, model: "m" }
    }),
    "draft_endpoint_invalid"
  );
  assert.equal(JSON.stringify(echoed).includes(secret), false, "api key must never be echoed");
  await expectRejected(
    await postJson(origin, "draft", {
      topic,
      endpoint: { kind: "openai", baseUrl: "https://api.example", apiKey: "k".repeat(501), model: "m" }
    }),
    "draft_endpoint_invalid"
  );
  assert.equal(submitted.length, 0);

  // Валидные формы по-прежнему проходят: bridge по умолчанию и openai.
  const bridged = await postJson(origin, "draft", { topic, sceneCount: 4, research: false });
  assert.equal(bridged.status, 202);
  const viaOpenAi = await postJson(origin, "draft", {
    topic,
    endpoint: { kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "kimi" }
  });
  assert.equal(viaOpenAi.status, 202);
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].endpoint.kind, "openai");
});

test("render route rejects malformed project, platform and projectId with specific codes", async t => {
  const submitted = [];
  const origin = await startHandler(t, { manager: trackingRenderManager(submitted) });

  await expectRejected(await postJson(origin, "render", {}), "render_project_invalid");
  await expectRejected(await postJson(origin, "render", { project: [] }), "render_project_invalid");
  await expectRejected(await postJson(origin, "render", { project: "board" }), "render_project_invalid");
  await expectRejected(
    await postJson(origin, "render", { project: { schemaVersion: 1 }, platform: 42 }),
    "render_platform_invalid"
  );
  await expectRejected(
    await postJson(origin, "render", { project: { schemaVersion: 1 }, platform: "../../etc" }),
    "render_platform_invalid"
  );
  await expectRejected(
    await postJson(origin, "render", { project: { schemaVersion: 1 }, projectId: { id: 1 } }),
    "render_project_id_invalid"
  );
  await expectRejected(
    await postJson(origin, "render", { project: { schemaVersion: 1 }, projectId: "x".repeat(121) }),
    "render_project_id_invalid"
  );
  assert.equal(submitted.length, 0, "invalid renders must never reach the manager");

  // Валидная форма (как шлёт фронт: projectId может быть пустой строкой).
  const accepted = await postJson(origin, "render", {
    project: { schemaVersion: 1, title: "ok", cards: [] },
    projectId: "",
    platform: "youtube_video"
  });
  assert.equal(accepted.status, 202);
  assert.equal(submitted.length, 1);
});

test("draft job ids outside the strict pattern fall through to a structured 404", async t => {
  const origin = await startHandler(t, {
    manager: createLocalMediaJobManager({ executeRender: async () => ({}) })
  });
  for (const suffix of ["draft/%2e%2e", "draft/DRAFT_upper", "draft/draft_%2f..%2f"]) {
    const response = await fetch(`${origin}/api/local-media/${suffix}`, { headers: { origin } });
    assert.equal(response.status, 404, `expected 404 for ${suffix}`);
    const body = await response.json();
    assert.equal(body.code, "not_found");
  }
});
