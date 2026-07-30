import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESENTER_ANGLES,
  buildPresenterTimeline,
  calculatePresenterAngle,
  evaluatePresenterOpacity,
  loadPresenterAtlas,
  presenterStageCss,
  renderPresenterMarkup
} from "../../src/media/presenter-stage.js";
import { buildSceneMarkup } from "../../src/media/scene-markup.js";

const ATLAS = Object.freeze({
  id: "kael",
  frameWidth: 420,
  frameHeight: 590,
  stepDegrees: 10,
  frames: Object.freeze(Array.from({ length: 36 }, (_, index) => ({
    angle: index * 10,
    file: "k" + String(index + 1).padStart(3, "0") + ".png"
  })))
});

const BEATS = Object.freeze([
  Object.freeze({
    atMs: 0,
    moveTo: 0.3,
    window: Object.freeze({ x: 0.8, y: 0.7, title: "Справа", lines: Object.freeze(["Первая строка"]) })
  }),
  Object.freeze({
    atMs: 6000,
    moveTo: 0.7,
    window: Object.freeze({ x: 0.2, y: 0.7, title: "Слева", lines: Object.freeze(["Вторая строка", "Третья строка"]) })
  })
]);

function timeline() {
  return buildPresenterTimeline({
    beats: BEATS,
    frameWidth: 1920,
    frameHeight: 1080,
    atlas: ATLAS,
    startX: 0.5,
    durationMs: 9000
  });
}

test("presenter angle is calculated from the window position", () => {
  assert.equal(calculatePresenterAngle({ presenterCenter: { x: 500, y: 500 }, windowCenter: { x: 900, y: 500 } }), 90);
  assert.equal(calculatePresenterAngle({ presenterCenter: { x: 500, y: 500 }, windowCenter: { x: 100, y: 500 } }), 270);
  assert.equal(calculatePresenterAngle({ presenterCenter: { x: 500, y: 500 }, windowCenter: { x: 500, y: 100 } }), 0);
  assert.equal(timeline().beats[0].angle, 90);
  assert.equal(timeline().beats[1].angle, 270);
});

test("presenter view switching is a 1ms hard cut and all view opacity sums to one", () => {
  const plan = timeline();
  assert.equal(plan.hardCuts.length, 1);
  assert.equal(plan.hardCuts[0].endMs - plan.hardCuts[0].atMs, 1);
  const opacityTimes = [...new Set(PRESENTER_ANGLES.flatMap(angle =>
    plan.layers["presenter-a" + angle].opacity.map(frame => frame.atMs)
  ))].sort((left, right) => left - right);
  const sampleTimes = [...opacityTimes, ...opacityTimes.slice(1).map((time, index) => (opacityTimes[index] + time) / 2)];
  for (const time of sampleTimes) {
    const total = Object.values(evaluatePresenterOpacity(plan, time)).reduce((sum, opacity) => sum + opacity, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, "opacity sum at " + time + "ms is " + total);
  }
  for (const angle of PRESENTER_ANGLES) {
    const frames = plan.layers["presenter-a" + angle].opacity;
    for (let index = 1; index < frames.length; index += 1) {
      if (frames[index].value !== frames[index - 1].value) {
        assert.equal(frames[index].atMs - frames[index - 1].atMs, 1);
      }
    }
  }
});

test("presenter windows never exceed 34 percent of the frame", () => {
  for (const width of [360, 1080, 1920, 3840]) {
    const plan = buildPresenterTimeline({ beats: BEATS, frameWidth: width, frameHeight: Math.round(width * 9 / 16), atlas: ATLAS });
    for (const beat of plan.beats) assert.ok(beat.window.width <= width * 0.34);
  }
});

test("presenter, windows, and hand links remain inside the frame", () => {
  const plan = timeline();
  for (const point of plan.layers.presenter.translateX) {
    assert.ok(point.value >= 0);
    assert.ok(point.value + plan.presenter.width <= plan.frame.width);
  }
  for (const beat of plan.beats) {
    assert.ok(beat.window.x >= 0 && beat.window.y >= 0);
    assert.ok(beat.window.x + beat.window.width <= plan.frame.width);
    assert.ok(beat.window.y + beat.window.height <= plan.frame.height);
    assert.ok(beat.link.x >= 0 && beat.link.y >= 0);
    assert.ok(beat.link.x + beat.link.width <= plan.frame.width);
    assert.ok(beat.link.y + beat.link.height <= plan.frame.height);
  }
  const markup = renderPresenterMarkup({ timeline: plan, atlas: ATLAS, beats: BEATS });
  assert.match(markup, /data-layer-id="presenter-a0"/);
  assert.match(markup, /data-layer-id="presenter-a315"/);
  assert.match(presenterStageCss({ timeline: plan }), /clip-path:inset/);
});

test("a missing presenter atlas produces a clear error", () => {
  assert.throws(
    () => loadPresenterAtlas("kael", { assetsRoot: "/tmp/hermest-board-test-no-presenter-atlas" }),
    /Presenter atlas is missing for "kael"/
  );
  assert.throws(
    () => buildSceneMarkup({
      scene: {
        title: "Ведущий",
        narration: "Ведущий объясняет.",
        sceneData: { presenter: { id: "missing_presenter_test", startX: 0.5 }, beats: [] }
      },
      sceneIndex: 0,
      sceneTitles: ["Ведущий"],
      brief: { topic: "Проверка", language: "ru" },
      width: 1920,
      height: 1080,
      seed: 1,
      archetype: "presenter",
      role: "body"
    }),
    /Presenter atlas is missing for "missing_presenter_test"/
  );
});
