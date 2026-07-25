import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubtitleCues,
  formatSrt
} from "../../src/media/subtitles.js";

const storyboard = {
  scenes: [
    { id: "scene-a", narration: "Первая сцена.", durationMs: 2500 },
    { id: "scene-b", narration: "Вторая сцена.", durationMs: 3000 }
  ]
};

test("subtitle cues follow the measured storyboard timeline", () => {
  const cues = buildSubtitleCues(storyboard);

  assert.deepEqual(cues, [
    { index: 1, sceneId: "scene-a", startMs: 0, endMs: 2500, text: "Первая сцена." },
    { index: 2, sceneId: "scene-b", startMs: 2500, endMs: 5500, text: "Вторая сцена." }
  ]);
});

test("formatSrt emits valid sequential timestamps", () => {
  const srt = formatSrt(buildSubtitleCues(storyboard));

  assert.equal(
    srt,
    "1\n00:00:00,000 --> 00:00:02,500\nПервая сцена.\n\n" +
    "2\n00:00:02,500 --> 00:00:05,500\nВторая сцена.\n"
  );
});

test("subtitle cues end with the measured narration inside each scene", () => {
  const cues = buildSubtitleCues({
    scenes: [
      { id: "scene-a", narration: "Первая сцена.", durationMs: 3000, narrationDurationMs: 2600 },
      { id: "scene-b", narration: "Вторая сцена.", durationMs: 2000, narrationDurationMs: 1500 }
    ]
  });

  assert.deepEqual(cues, [
    { index: 1, sceneId: "scene-a", startMs: 0, endMs: 2600, text: "Первая сцена." },
    { index: 2, sceneId: "scene-b", startMs: 3000, endMs: 4500, text: "Вторая сцена." }
  ]);
  assert.ok(cues.every(cue => cue.endMs <= 5000));
});

test("a multi-sentence scene becomes one cue per sentence, split by measured time", () => {
  const cues = buildSubtitleCues({
    scenes: [{
      id: "scene-a",
      narration: "Раз два. Три четыре.",
      durationMs: 4400,
      narrationDurationMs: 4000
    }]
  });

  assert.equal(cues.length, 2);
  assert.deepEqual(cues.map(cue => cue.text), ["Раз два.", "Три четыре."]);
  // Оба предложения одной сцены остаются внутри её измеренной озвучки.
  assert.equal(cues[0].startMs, 0);
  assert.equal(cues.at(-1).endMs, 4000);
  // Границы стыкуются без дыр и нахлёстов.
  assert.equal(cues[0].endMs, cues[1].startMs);
  // Более длинное предложение висит дольше.
  assert.ok(cues[1].endMs - cues[1].startMs > cues[0].endMs - cues[0].startMs);
});

test("cue numbering stays sequential across scenes", () => {
  const cues = buildSubtitleCues({
    scenes: [
      { id: "scene-a", narration: "Раз. Два.", durationMs: 2000 },
      { id: "scene-b", narration: "Три.", durationMs: 2000 }
    ]
  });

  assert.deepEqual(cues.map(cue => cue.index), [1, 2, 3]);
  assert.deepEqual(cues.map(cue => cue.sceneId), ["scene-a", "scene-a", "scene-b"]);
});

test("an over-long sentence is wrapped on word boundaries, never mid-word", () => {
  const word = "слово";
  const narration = `${Array.from({ length: 40 }, () => word).join(" ")}.`;
  const cues = buildSubtitleCues(
    { scenes: [{ id: "scene-a", narration, durationMs: 8000 }] },
    { width: 1920, subtitleLayout: { maxLines: 2 } }
  );

  assert.ok(cues.length > 1, "длинное предложение должно быть разбито");
  assert.ok(cues.every(cue => cue.text.length <= 110));
  // Ни одно слово не разрезано: склейка реплик восстанавливает исходный текст.
  assert.equal(cues.map(cue => cue.text).join(" "), narration);
});

test("narrower frames get shorter cues", () => {
  const scenes = [{ id: "scene-a", narration: `${Array.from({ length: 30 }, () => "слово").join(" ")}.`, durationMs: 8000 }];
  const wide = buildSubtitleCues({ scenes }, { width: 1920, subtitleLayout: { maxLines: 2 } });
  const tall = buildSubtitleCues({ scenes }, { width: 1080, subtitleLayout: { maxLines: 2 } });

  assert.ok(tall.length > wide.length, "вертикальный кадр вмещает меньше символов в строку");
});

test("subtitle builder rejects non-positive scene duration", () => {
  assert.throws(
    () => buildSubtitleCues({ scenes: [{ id: "bad", narration: "Ошибка", durationMs: 0 }] }),
    /positive duration/
  );
});
