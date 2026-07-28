import assert from "node:assert/strict";
import test from "node:test";

import { applyNarrationOverrides } from "../../src/media/narration.js";

const PROJECT = Object.freeze({
  title: "тест",
  brief: Object.freeze({ language: "ru", narrationProvider: "piper", voice: "ru_RU-dmitri-medium" }),
  cards: []
});
const ATERNA = "UX4FA7ZvSPh1ma6rI8P9";

test("no overrides leaves the project exactly as it was", () => {
  assert.equal(applyNarrationOverrides(PROJECT, {}), PROJECT);
  assert.equal(applyNarrationOverrides(PROJECT), PROJECT);
});

test("provider and voice together switch the narration", () => {
  const next = applyNarrationOverrides(PROJECT, { provider: "elevenlabs", voice: ATERNA });
  assert.equal(next.brief.narrationProvider, "elevenlabs");
  assert.equal(next.brief.voice, ATERNA);
  assert.equal(next.brief.language, "ru", "остальной бриф не трогаем");
  assert.equal(PROJECT.brief.voice, "ru_RU-dmitri-medium", "исходный проект не мутируется");
});

// Ровно тот случай, который однажды уже увёл рендер на английский premade-голос:
// провайдер сменили, а голос остался пайперовский.
test("switching to ElevenLabs without a voice is refused", () => {
  assert.throws(
    () => applyNarrationOverrides(PROJECT, { provider: "elevenlabs" }),
    /requires --voice/u
  );
});

test("a Piper voice name is not accepted as an ElevenLabs id", () => {
  assert.throws(
    () => applyNarrationOverrides(PROJECT, { provider: "elevenlabs", voice: "ru_RU-dmitri-medium" }),
    /Not an ElevenLabs voice id/u
  );
});

test("an unknown provider names the ones that exist", () => {
  assert.throws(
    () => applyNarrationOverrides(PROJECT, { provider: "aterna-cloud" }),
    error => {
      assert.match(error.message, /Unknown narration provider: aterna-cloud/u);
      assert.match(error.message, /piper/u);
      return true;
    }
  );
});

test("a voice swap inside ElevenLabs needs no provider argument", () => {
  const onElevenLabs = { ...PROJECT, brief: { ...PROJECT.brief, narrationProvider: "elevenlabs", voice: ATERNA } };
  const next = applyNarrationOverrides(onElevenLabs, { voice: "AbCdEfGh12345678" });
  assert.equal(next.brief.voice, "AbCdEfGh12345678");
  assert.equal(next.brief.narrationProvider, "elevenlabs");
});

test("a voice name with a path in it is refused", () => {
  assert.throws(
    () => applyNarrationOverrides(PROJECT, { voice: "../../etc/passwd" }),
    /Not a voice name/u
  );
});
