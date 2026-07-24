import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildEditionManifest, createEdition, translateEdition } from "../../src/media/edition.js";

const SHA256 = /^[a-f0-9]{64}$/;

function sampleProject() {
  return {
    schemaVersion: 4,
    title: "Sky",
    projectId: "proj-sky",
    brief: { language: "ru", topic: "sky" },
    cards: [
      { id: "a", title: "One", text: "Первая сцена.", x: 0, y: 0 },
      { id: "b", title: "Two", text: "Вторая сцена.", x: 0, y: 10 }
    ]
  };
}

async function readyEdition() {
  return translateEdition(
    createEdition({ project: sampleProject(), targetLanguage: "en", env: {} }),
    { translate: async ({ text, targetLanguage }) => `[${targetLanguage}] ${text}`, modelId: "gpt-test" }
  );
}

test("buildEditionManifest records language, model, voice and per-segment hashes", async () => {
  const edition = await readyEdition();
  const manifest = buildEditionManifest(edition);
  assert.equal(manifest.kind, "multilingual-edition");
  assert.equal(manifest.editionId, edition.id);
  assert.equal(manifest.projectId, "proj-sky");
  assert.equal(manifest.sourceLanguage, "ru");
  assert.equal(manifest.targetLanguage, "en");
  assert.equal(manifest.voiceId, "en_US-lessac-medium");
  assert.equal(manifest.voiceProvider, "piper");
  assert.equal(manifest.translationModelId, "gpt-test");
  assert.equal(manifest.segments.length, 2);
  for (const segment of manifest.segments) {
    assert.equal(typeof segment.sceneId, "string");
    assert.match(segment.sourceSha256, SHA256);
    assert.match(segment.translatedSha256, SHA256);
  }
  // Hashes are content-addressed to the actual text.
  const expected = createHash("sha256").update(edition.segments[0].translatedText).digest("hex");
  assert.equal(manifest.segments[0].translatedSha256, expected);
});

test("buildEditionManifest folds in the rendered artifact hashes when provided", async () => {
  const edition = await readyEdition();
  const manifest = buildEditionManifest(edition, {
    render: { manifestSha256: "a".repeat(64), videoSha256: "b".repeat(64), recipeId: "youtube_video_r1" }
  });
  assert.equal(manifest.render.manifestSha256, "a".repeat(64));
  assert.equal(manifest.render.videoSha256, "b".repeat(64));
  assert.equal(manifest.render.recipeId, "youtube_video_r1");
});

test("buildEditionManifest is deterministic and refuses an untranslated edition", async () => {
  const a = buildEditionManifest(await readyEdition());
  const b = buildEditionManifest(await readyEdition());
  assert.deepEqual(a, b);

  const draft = createEdition({ project: sampleProject(), targetLanguage: "en", env: {} });
  assert.throws(() => buildEditionManifest(draft), /ready/i);
});
