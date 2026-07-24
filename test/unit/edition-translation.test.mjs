import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITION_STATUSES,
  buildTranslatedProject,
  createEdition,
  translateEdition
} from "../../src/media/edition.js";
import { createEditionTranslator } from "../../src/media/edition-translator.js";
import { buildStoryboard, buildNarrationScript } from "../../src/domain/content-pipeline.js";

function sampleProject(overrides = {}) {
  return {
    schemaVersion: 4,
    title: "Почему небо голубое",
    projectId: "proj-sky",
    brief: { language: "ru", voice: "", narrationProvider: "", topic: "небо", music: "off", generateVisuals: false },
    cards: [
      { id: "intro", title: "Введение", text: "Небо голубое.", x: 0, y: 0, image: "https://ex/a.png" },
      { id: "detail", title: "Детали", text: "Свет рассеивается.", x: 0, y: 10, assetRef: "asset-1" }
    ],
    ...overrides
  };
}

// Deterministic mock translator: records calls, echoes a stable prefix.
function mockTranslate(record) {
  return async ({ text, targetLanguage }) => {
    record.push({ text, targetLanguage });
    return `[${targetLanguage}] ${text}`;
  };
}

test("translateEdition fills every segment and transitions draft -> ready", async () => {
  const calls = [];
  const edition = createEdition({ project: sampleProject(), targetLanguage: "en", env: {} });
  const translated = await translateEdition(edition, { translate: mockTranslate(calls), modelId: "mock-model" });
  assert.equal(translated.status, EDITION_STATUSES.READY);
  assert.equal(translated.translationModelId, "mock-model");
  assert.equal(translated.segments.length, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.targetLanguage, "en");
  for (const segment of translated.segments) {
    assert.equal(typeof segment.translatedText, "string");
    assert.match(segment.translatedText, /^\[en\] /);
  }
  // Order preserved (scene mapping intact).
  assert.match(translated.segments[0].translatedText, /Небо голубое/);
});

test("translateEdition on translator failure yields a safe error status", async () => {
  const edition = createEdition({ project: sampleProject(), targetLanguage: "en", env: {} });
  const translated = await translateEdition(edition, {
    translate: async () => { throw new Error("boom /home/secret/x.js"); }
  });
  assert.equal(translated.status, EDITION_STATUSES.ERROR);
  assert.equal(typeof translated.message, "string");
  assert.doesNotMatch(translated.message, /\/home|\{|\}|at .+\.js:/);
});

test("translateEdition on an empty translation yields error, not ready", async () => {
  const edition = createEdition({ project: sampleProject(), targetLanguage: "en", env: {} });
  const translated = await translateEdition(edition, { translate: async () => "   " });
  assert.equal(translated.status, EDITION_STATUSES.ERROR);
});

test("translateEdition leaves a voice_missing edition untouched", async () => {
  const edition = createEdition({ project: sampleProject(), targetLanguage: "ja", env: {} });
  assert.equal(edition.status, EDITION_STATUSES.VOICE_MISSING);
  let called = false;
  const translated = await translateEdition(edition, { translate: async () => { called = true; return "x"; } });
  assert.equal(translated.status, EDITION_STATUSES.VOICE_MISSING);
  assert.equal(called, false);
});

test("buildTranslatedProject produces a renderable board in the target language", async () => {
  const project = sampleProject();
  const edition = await translateEdition(
    createEdition({ project, targetLanguage: "en", env: {} }),
    { translate: mockTranslate([]) }
  );
  const translatedProject = buildTranslatedProject(project, edition);

  assert.equal(translatedProject.brief.language, "en");
  assert.equal(translatedProject.brief.voice, "en_US-lessac-medium");
  assert.equal(translatedProject.brief.narrationProvider, "");
  // Additive brief fields preserved.
  assert.equal(translatedProject.brief.music, "off");
  assert.equal(translatedProject.brief.generateVisuals, false);

  // The board is valid and its spoken narration is the translated text.
  const storyboard = buildStoryboard(translatedProject);
  assert.equal(storyboard.scenes.length, 2);
  const narration = buildNarrationScript(storyboard);
  assert.match(narration, /\[en\] .*Небо голубое/);
  // Source-language voiceover text is gone from the spoken script structure.
  assert.equal(storyboard.scenes.length, buildStoryboard(project).scenes.length);

  // Visuals reused: image + assetRef carried over per scene.
  const visuals = storyboard.scenes.map(scene => scene.visual);
  assert.ok(visuals.some(visual => visual.image === "https://ex/a.png"));
  assert.ok(visuals.some(visual => visual.assetRef === "asset-1"));
});

test("buildTranslatedProject refuses an untranslated edition", () => {
  const project = sampleProject();
  const draft = createEdition({ project, targetLanguage: "en", env: {} });
  assert.throws(() => buildTranslatedProject(project, draft), /ready/i);
});

test("buildTranslatedProject wires ElevenLabs provider for non-piper languages", async () => {
  const project = sampleProject();
  const edition = await translateEdition(
    createEdition({ project, targetLanguage: "ja", env: { HERMEST_ELEVENLABS_API_KEY: "sk_x" } }),
    { translate: mockTranslate([]) }
  );
  const translatedProject = buildTranslatedProject(project, edition);
  assert.equal(translatedProject.brief.language, "ja");
  assert.equal(translatedProject.brief.narrationProvider, "elevenlabs");
  assert.equal(translatedProject.brief.voice, "");
});

// --- edition-translator (injected text model) ---

test("createEditionTranslator calls the text model at temperature 0 with a translate-only prompt", async () => {
  const seen = [];
  const textModel = {
    provider: "openai-compatible",
    model: "gpt-test",
    async complete(options) {
      seen.push(options);
      return "  Hello world  ";
    }
  };
  const translator = createEditionTranslator({ textModel });
  assert.equal(translator.modelId, "gpt-test");
  const out = await translator.translate({ text: "Привет мир", targetLanguage: "en" });
  assert.equal(out, "Hello world");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].temperature, 0);
  assert.equal(seen[0].prompt, "Привет мир");
  assert.match(seen[0].system, /English/);
});

test("createEditionTranslator strips wrapping quotes and rejects empty output", async () => {
  const translator = createEditionTranslator({
    textModel: { model: "m", async complete() { return "\"Bonjour\""; } }
  });
  assert.equal(await translator.translate({ text: "Привет", targetLanguage: "fr" }), "Bonjour");

  const empty = createEditionTranslator({ textModel: { model: "m", async complete() { return ""; } } });
  await assert.rejects(() => empty.translate({ text: "Привет", targetLanguage: "fr" }), /empty|translation/i);
});
