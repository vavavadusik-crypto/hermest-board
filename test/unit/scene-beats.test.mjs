// Доли сцены (beat track). Здесь важны не сами окна, а обещания, которые
// держат кадр живым и детерминированным: доли идут по виртуальному времени
// диктора, не выталкивают элемент за контейнер и при выключенных анимациях
// дают ровно последний кадр сцены.

import assert from "node:assert/strict";
import test from "node:test";

import { buildBeatCss, planBeats } from "../../src/media/scene-beats.js";
import { buildSceneMarkup } from "../../src/media/scene-markup.js";

const CASES = [
  { durationMs: 8000, count: 1 },
  { durationMs: 9500, count: 3 },
  { durationMs: 15000, count: 5 },
  { durationMs: 1200, count: 4 },
  { durationMs: 60000, count: 8 }
];

test("beats split the scene into contiguous windows in reading order", () => {
  for (const { durationMs, count } of CASES) {
    const beats = planBeats({ durationMs, count });
    assert.equal(beats.length, count, `долей ${beats.length} вместо ${count}`);
    for (let index = 0; index < beats.length; index += 1) {
      assert.ok(beats[index].startMs < beats[index].endMs, `доля ${index} нулевой длины`);
      if (index > 0) {
        assert.equal(beats[index].startMs, beats[index - 1].endMs, `доли ${index - 1} и ${index} разошлись`);
      }
    }
  }
});

test("the last beat ends at least 0.4s before the scene ends", () => {
  for (const { durationMs, count } of CASES) {
    const beats = planBeats({ durationMs, count });
    const tail = durationMs - beats.at(-1).endMs;
    assert.ok(tail >= 400, `последняя доля кончается за ${tail} мс до конца сцены`);
  }
});

test("the first beat starts after the shell build-in, not at zero", () => {
  const [first] = planBeats({ durationMs: 10000, count: 4 });
  assert.ok(first.startMs >= 400, `первая доля началась в ${first.startMs} мс — утонет в появлении шелла`);
  assert.ok(first.startMs <= 2000, `первая доля началась в ${first.startMs} мс — сцена простаивает`);
});

test("a single element still gets a working window", () => {
  const [beat] = planBeats({ durationMs: 8000, count: 1 });
  assert.ok(beat.startMs < beat.endMs, "единственная доля нулевой длины");
  assert.ok(8000 - beat.endMs >= 400, "единственная доля упирается в конец сцены");
});

test("zero, negative and missing scene length fall back instead of breaking", () => {
  for (const durationMs of [0, -5000, undefined, Number.NaN, "текст"]) {
    const beats = planBeats({ durationMs, count: 3 });
    assert.equal(beats.length, 3, `длительность ${durationMs}: доли не построились`);
    assert.ok(beats[0].startMs < beats[0].endMs, `длительность ${durationMs}: пустое окно`);
  }
});

test("an empty list produces no beats and no CSS", () => {
  assert.deepEqual(planBeats({ durationMs: 8000, count: 0 }), []);
  assert.equal(buildBeatCss({ durationMs: 8000, count: 0, selector: ".x", name: "x" }), "");
});

test("the same input yields byte-identical CSS", () => {
  const input = { durationMs: 9500, count: 3, selector: ".cl-row", name: "cl" };
  assert.equal(buildBeatCss(input), buildBeatCss(input), "CSS недетерминирован");
  assert.notEqual(
    buildBeatCss(input),
    buildBeatCss({ ...input, count: 4 }),
    "разное число элементов дало тот же CSS"
  );
});

test("the base style is the final state and keyframes only lead to it", () => {
  const css = buildBeatCss({ durationMs: 9500, count: 3, selector: ".cl-row", name: "cl" });
  // База элемента — отыгранная доля: та же непрозрачность, что на 100% keyframes.
  const finalOpacity = css.match(/100% \{ opacity: ([\d.]+);/u)[1];
  const base = css.match(/\.cl-row \{\s*opacity: ([\d.]+);/u);
  assert.ok(base, "базовое правило элемента не найдено");
  assert.equal(base[1], finalOpacity, "база элемента не равна конечному кадру доли");
  assert.match(css, /backwards;/u, "нет fill-mode backwards — замороженный кадр уедет");
  assert.ok(!/forwards/u.test(css), "forwards сломал бы статичный кадр со списком");
  // Окно едет по номеру элемента, а не размножением правил.
  assert.match(css, /var\(--i\)/u, "окно доли не привязано к --i");
});

test("the accent lift is a few pixels, never a jump", () => {
  const css = buildBeatCss({ durationMs: 12000, count: 5, selector: ".fs-step", name: "fs" });
  const lifts = [...css.matchAll(/translateY\((-?\d+)px\)/gu)].map(match => Math.abs(Number(match[1])));
  assert.ok(lifts.length >= 3, "доля не двигает элемент вовсе");
  for (const lift of lifts) {
    assert.ok(lift <= 12, `сдвиг ${lift}px — это уже прыжок, а не акцент`);
  }
});

test("generated CSS carries no raw control characters", () => {
  const css = buildBeatCss({ durationMs: 9500, count: 3, selector: ".cl-row", name: "cl" });
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(css), "управляющий символ в CSS долей");
});

test("a bad track name is rejected, not embedded into CSS", () => {
  assert.throws(
    () => buildBeatCss({ durationMs: 8000, count: 2, selector: ".x", name: "x</style>" }),
    RangeError,
    "имя дорожки попало в CSS без проверки"
  );
});

function sceneMarkup({ animated }) {
  return buildSceneMarkup({
    scene: {
      title: "Проверки",
      narration: "Проверки. Длительность; громкость; субтитры.",
      durationMs: 9000
    },
    sceneIndex: 1,
    sceneTitles: ["Первая", "Вторая", "Третья"],
    brief: { topic: "Конвейер", language: "ru" },
    width: 1920,
    height: 1080,
    seed: 5,
    safeZones: { top: 54, right: 96, bottom: 54, left: 96 },
    archetype: "checklist",
    animated
  });
}

test("list archetypes render their beat track into the scene", () => {
  const markup = sceneMarkup({ animated: true });
  assert.match(markup, /@keyframes beat-cl/u, "в сцене checklist нет дорожки долей");
  assert.match(markup, /\.cl-row \{\s*opacity: [\d.]+;\s*animation: beat-cl/u, "пункты не привязаны к долям");
  assert.ok(!markup.includes("undefined"), "undefined утёк в разметку");
});

test("the frozen frame of a list scene equals its last frame", () => {
  const animated = sceneMarkup({ animated: true });
  const still = sceneMarkup({ animated: false });
  // Статичная разметка отличается ровно одним правилом — глушителем анимаций.
  assert.equal(still.replace("\n  * { animation: none !important; }", ""), animated);
});

test("a scene without durationMs still renders its beat track", () => {
  const markup = buildSceneMarkup({
    scene: { title: "Проверки", narration: "Проверки. Длительность; громкость." },
    sceneIndex: 0,
    sceneTitles: ["Первая"],
    brief: { topic: "Конвейер", language: "ru" },
    width: 1920,
    height: 1080,
    seed: 1,
    safeZones: { top: 54, right: 96, bottom: 54, left: 96 },
    archetype: "checklist"
  });
  assert.match(markup, /@keyframes beat-cl/u, "сцена без длительности потеряла доли");
  assert.ok(!markup.includes("NaN"), "NaN утёк в разметку");
});

// Доля — это акцент, а не выключатель. Отыгравший элемент обязан остаться
// читаемым: последний кадр сцены показывает ВЕСЬ список отыгравшим, и он же
// уходит в обложку.
test("a spent beat stays readable instead of fading out", () => {
  const css = buildBeatCss({ durationMs: 12000, count: 3, selector: ".x", name: "x" });
  const [, rest] = css.match(/\.x \{\s*opacity: ([\d.]+);/u);
  assert.ok(Number(rest) >= 0.8, `покой на ${rest} — список к концу сцены выцветает`);
  assert.ok(Number(rest) < 1, "без разницы с активной долей акцент не читается");
});
