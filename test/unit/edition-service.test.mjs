import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { editionService, toPublicEdition } from "../../src/local-media/edition-service.js";
import { createLocalMediaRequestHandler } from "../../src/local-media/vite-plugin.js";

function sampleProject() {
  return {
    schemaVersion: 4,
    title: "Sky",
    projectId: "proj-sky",
    brief: { language: "ru", topic: "sky" },
    cards: [
      { id: "a", title: "One", text: "Первая сцена о небе.", x: 0, y: 0 },
      { id: "b", title: "Two", text: "Вторая сцена о свете.", x: 0, y: 10 }
    ]
  };
}

const echoModel = {
  model: "mock-model",
  provider: "mock",
  async complete({ prompt }) { return `[t] ${prompt}`; }
};

// --- editionService (injected text model, no network) ---

test("editionService translates and returns a renderable board for a piper language", async () => {
  const result = await editionService({
    project: sampleProject(),
    targetLanguage: "en",
    env: {},
    textModel: echoModel,
    availabilityCheck: async () => ({ status: "executable" })
  });
  assert.equal(result.edition.status, "ready");
  assert.ok(result.project, "translated project returned");
  assert.equal(result.project.brief.language, "en");
  assert.equal(result.project.brief.voice, "en_US-lessac-medium");
  assert.equal(result.manifest.targetLanguage, "en");
  assert.equal(result.manifest.translationModelId, "mock-model");
});

test("editionService returns voice_missing without invoking the model", async () => {
  const guardModel = { model: "x", async complete() { throw new Error("should not translate"); } };
  const result = await editionService({
    project: sampleProject(),
    targetLanguage: "ja",
    env: {},
    textModel: guardModel
  });
  assert.equal(result.edition.status, "voice_missing");
  assert.equal(result.project, null);
  assert.equal(result.manifest, null);
});

test("editionService fails closed when the bridge is unavailable (no direct endpoint)", async () => {
  await assert.rejects(
    () => editionService({
      project: sampleProject(),
      targetLanguage: "en",
      env: {},
      availabilityCheck: async () => ({ status: "missing", reason: "bridge down" })
    }),
    error => error.statusCode === 503
  );
});

test("editionService with a direct OpenAI endpoint skips the bridge check", async () => {
  const result = await editionService({
    project: sampleProject(),
    targetLanguage: "de",
    env: {},
    endpoint: { kind: "openai", baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m" },
    textModel: echoModel,
    availabilityCheck: async () => { throw new Error("bridge must not be checked"); }
  });
  assert.equal(result.edition.status, "ready");
  assert.equal(result.project.brief.language, "de");
});

test("toPublicEdition hides raw segment text but keeps status + provenance", async () => {
  const result = await editionService({ project: sampleProject(), targetLanguage: "en", env: {}, textModel: echoModel, availabilityCheck: async () => ({ status: "executable" }) });
  const pub = toPublicEdition(result.edition);
  assert.equal(pub.status, "ready");
  assert.equal(pub.targetLanguage, "en");
  assert.equal(pub.sceneCount, 2);
  assert.equal(pub.segments, undefined);
});

// --- HTTP route wiring ---

async function withHandler(runEdition, fn) {
  const manager = {
    submit() { return {}; },
    get() { return null; },
    cancel() { return {}; },
    resolveArtifact() { throw new Error("nope"); }
  };
  const server = createServer(createLocalMediaRequestHandler({ manager, runEdition }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(origin);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("POST /edition returns the public edition and translated project", async () => {
  let received = null;
  const runEdition = async params => {
    received = params;
    return {
      edition: {
        id: "edition_x", projectId: "proj-sky", sourceLanguage: "ru", targetLanguage: "en",
        status: "ready", voiceProvider: "piper", voiceId: "en_US-lessac-medium",
        translationModelId: "mock-model", message: null, segments: [{}, {}]
      },
      project: { title: "Sky", brief: { language: "en" }, cards: [] }
    };
  };
  await withHandler(runEdition, async origin => {
    const response = await fetch(`${origin}/api/local-media/edition`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hermest-local-media": "1", origin },
      body: JSON.stringify({ project: sampleProject(), targetLanguage: "en" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.edition.status, "ready");
    assert.equal(body.edition.sceneCount, 2);
    assert.equal(body.project.brief.language, "en");
    assert.equal(received.targetLanguage, "en");
  });
});

test("POST /edition enforces the mutation header and validates the body", async () => {
  const runEdition = async () => { throw new Error("must not run"); };
  await withHandler(runEdition, async origin => {
    const noHeader = await fetch(`${origin}/api/local-media/edition`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ project: sampleProject(), targetLanguage: "en" })
    });
    assert.equal(noHeader.status, 403);

    const badProject = await fetch(`${origin}/api/local-media/edition`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hermest-local-media": "1", origin },
      body: JSON.stringify({ project: "nope", targetLanguage: "en" })
    });
    assert.equal(badProject.status, 400);
    assert.equal((await badProject.json()).code, "edition_project_invalid");

    const noLang = await fetch(`${origin}/api/local-media/edition`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hermest-local-media": "1", origin },
      body: JSON.stringify({ project: sampleProject() })
    });
    assert.equal(noLang.status, 400);
  });
});
