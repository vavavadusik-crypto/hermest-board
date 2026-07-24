import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITION_STATUSES,
  createEdition,
  deriveEditionSegments,
  resolveEditionVoice
} from "../../src/media/edition.js";

function sampleProject(overrides = {}) {
  return {
    schemaVersion: 4,
    title: "Почему небо голубое",
    projectId: "proj-sky",
    brief: { language: "ru", voice: "", narrationProvider: "", topic: "небо" },
    cards: [
      { id: "intro", title: "Введение", text: "Небо голубое из-за рассеяния света.", x: 0, y: 0 },
      { id: "detail", title: "Детали", text: "Молекулы воздуха рассеивают синий сильнее.", x: 0, y: 10 }
    ],
    ...overrides
  };
}

test("deriveEditionSegments yields one segment per storyboard scene with spoken text", () => {
  const segments = deriveEditionSegments(sampleProject());
  assert.equal(segments.length, 2);
  for (const segment of segments) {
    assert.equal(typeof segment.sceneId, "string");
    assert.ok(segment.sceneId.length > 0);
    assert.equal(typeof segment.sourceText, "string");
    assert.ok(segment.sourceText.length > 0);
  }
  // Order follows the storyboard (y then x): intro before detail.
  assert.match(segments[0].sourceText, /Небо голубое/);
  assert.match(segments[1].sourceText, /рассеивают синий/);
});

test("resolveEditionVoice maps piper languages to an offline voice", () => {
  for (const [language, expected] of [
    ["ru", "ru_RU-dmitri-medium"],
    ["en", "en_US-lessac-medium"],
    ["es", "es_ES-davefx-medium"],
    ["de", "de_DE-thorsten-medium"],
    ["fr", "fr_FR-siwis-medium"]
  ]) {
    const resolved = resolveEditionVoice({ language, env: {} });
    assert.equal(resolved.status, "ok");
    assert.equal(resolved.provider, "piper");
    assert.equal(resolved.voiceId, expected);
  }
});

test("resolveEditionVoice falls back to ElevenLabs when a key is configured", () => {
  const resolved = resolveEditionVoice({
    language: "ja",
    env: { HERMEST_ELEVENLABS_API_KEY: "sk_test_key" }
  });
  assert.equal(resolved.status, "ok");
  assert.equal(resolved.provider, "elevenlabs");
  assert.equal(typeof resolved.voiceId, "string");
  assert.ok(resolved.voiceId.length > 0);
});

test("resolveEditionVoice reports voice_missing without a raw stack/JSON", () => {
  const resolved = resolveEditionVoice({ language: "ja", env: {} });
  assert.equal(resolved.status, "voice_missing");
  assert.equal(resolved.provider, null);
  assert.equal(resolved.voiceId, null);
  assert.equal(typeof resolved.message, "string");
  assert.ok(resolved.message.length > 0);
  assert.doesNotMatch(resolved.message, /\{|\}|at .+\.js:|Error:/);
});

test("createEdition builds a draft edition with per-segment shape", () => {
  const edition = createEdition({ project: sampleProject(), targetLanguage: "en", env: {} });
  assert.equal(edition.status, EDITION_STATUSES.DRAFT);
  assert.equal(edition.projectId, "proj-sky");
  assert.equal(edition.sourceLanguage, "ru");
  assert.equal(edition.targetLanguage, "en");
  assert.equal(edition.voiceId, "en_US-lessac-medium");
  assert.equal(typeof edition.id, "string");
  assert.ok(edition.id.length > 0);
  assert.equal(edition.segments.length, 2);
  for (const segment of edition.segments) {
    assert.equal(typeof segment.sceneId, "string");
    assert.equal(typeof segment.sourceText, "string");
    assert.equal(segment.translatedText, null);
    assert.equal(segment.voiceId, "en_US-lessac-medium");
  }
});

test("createEdition is deterministic in id for the same project + target", () => {
  const a = createEdition({ project: sampleProject(), targetLanguage: "en", env: {} });
  const b = createEdition({ project: sampleProject(), targetLanguage: "en", env: {} });
  assert.equal(a.id, b.id);
  const other = createEdition({ project: sampleProject(), targetLanguage: "de", env: {} });
  assert.notEqual(a.id, other.id);
});

test("createEdition marks voice_missing when the target language has no voice", () => {
  const edition = createEdition({ project: sampleProject(), targetLanguage: "ja", env: {} });
  assert.equal(edition.status, EDITION_STATUSES.VOICE_MISSING);
  assert.equal(edition.voiceId, null);
  assert.equal(typeof edition.message, "string");
  assert.doesNotMatch(edition.message, /\{|\}|at .+\.js:/);
});

test("createEdition defaults sourceLanguage to en and derives a projectId", () => {
  const project = sampleProject({ projectId: undefined, brief: { topic: "x" } });
  const edition = createEdition({ project, targetLanguage: "de", env: {} });
  assert.equal(edition.sourceLanguage, "en");
  assert.equal(typeof edition.projectId, "string");
  assert.ok(edition.projectId.length > 0);
});

test("createEdition rejects an invalid target language", () => {
  assert.throws(() => createEdition({ project: sampleProject(), targetLanguage: "", env: {} }), /language/i);
  assert.throws(() => createEdition({ project: sampleProject(), targetLanguage: "not a lang!", env: {} }), /language/i);
});
