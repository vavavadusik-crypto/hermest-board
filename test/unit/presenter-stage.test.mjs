import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESENTER_ANGLES,
  PRESENTER_MAX_MOVE_SPEED_AT_1080,
  PRESENTER_MAX_WINDOW_WIDTH_RATIO,
  PRESENTER_REST_HEIGHT_RATIO,
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
  turn: Object.freeze({ frameWidth: 420, frameHeight: 590, stepDegrees: 10, frames: Object.freeze(Array.from({ length: 36 }, (_, index) => ({ angle: index * 10, file: "k" + String(index + 1).padStart(3, "0") + ".png" }))) }),
  walk: Object.freeze({ dir: "walk", frameWidth: 204, frameHeight: 512, frameDurationMs: 75, frames: Object.freeze(Array.from({ length: 12 }, (_, index) => "w" + String(index + 1).padStart(2, "0") + ".png")) }),
  gesture: Object.freeze({ dir: "gesture", frameWidth: 348, frameHeight: 512, poses: Object.freeze({ pointLeft: "g02.png", handUp: "g04.png" }) }),
  footAnchor: Object.freeze({ turn: 0.995, walk: 0.985, gesture: 1 }),
  figureHeightRatio: Object.freeze({ turn: 1, walk: 0.97, gesture: 0.62 })
});

const BEATS = Object.freeze([
  Object.freeze({ atMs: 0, moveTo: 0.3, window: Object.freeze({ x: 0.8, y: 0.7, title: "Справа", lines: Object.freeze(["Первая строка"]) }) }),
  Object.freeze({ atMs: 6000, moveTo: 0.7, window: Object.freeze({ x: 0.2, y: 0.7, title: "Слева", lines: Object.freeze(["Вторая строка", "Третья строка"]) }) })
]);

function timeline() {
  return buildPresenterTimeline({ beats: BEATS, frameWidth: 1920, frameHeight: 1080, atlas: ATLAS, startX: 0.5, durationMs: 9000 });
}

test("presenter angle is calculated from the window position", () => {
  assert.equal(calculatePresenterAngle({ presenterCenter: { x: 500, y: 500 }, windowCenter: { x: 900, y: 500 } }), 90);
  assert.equal(calculatePresenterAngle({ presenterCenter: { x: 500, y: 500 }, windowCenter: { x: 100, y: 500 } }), 270);
  assert.equal(calculatePresenterAngle({ presenterCenter: { x: 500, y: 500 }, windowCenter: { x: 500, y: 100 } }), 0);
  assert.equal(timeline().beats[0].angle, 90);
  assert.equal(timeline().beats[1].angle, 270);
});

test("presenter view switching is a 1ms hard cut and one presenter asset is visible", () => {
  const plan = timeline();
  assert.ok(plan.hardCuts.length > 1);
  for (const cut of plan.hardCuts) assert.equal(cut.endMs - cut.atMs, 1);
  const opacityTimes = [...new Set(Object.values(plan.layers).flatMap(layer => layer.opacity?.map(frame => frame.atMs) || []))].sort((left, right) => left - right);
  const sampleTimes = [...opacityTimes, ...opacityTimes.slice(1).map((time, index) => (opacityTimes[index] + time) / 2)];
  for (const time of sampleTimes) {
    const total = Object.values(evaluatePresenterOpacity(plan, time)).reduce((sum, opacity) => sum + opacity, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, "opacity sum at " + time + "ms is " + total);
  }
});

test("movement uses the walk loop, while a stopped presenter returns to turn", () => {
  const plan = timeline();
  const moving = plan.beats[0];
  assert.ok(plan.assets.filter(asset => asset.type === "walk").every(asset => plan.layers[asset.id].opacity.length > 1));
  assert.equal(evaluatePresenterOpacity(plan, moving.moveStartMs + 2)["presenter-walk-0"], 1);
  assert.equal(evaluatePresenterOpacity(plan, moving.moveEndMs + 2)["presenter-a" + moving.angle], 1);
});

test("movement is never faster than the 1080p gait limit and insufficient duration reports clearly", () => {
  const plan = timeline();
  for (const beat of plan.beats) assert.ok(beat.speedPxPerSecond <= PRESENTER_MAX_MOVE_SPEED_AT_1080 + 1e-9);
  assert.throws(() => buildPresenterTimeline({ beats: [{ atMs: 0, moveTo: 0.9, window: { x: 0.9, y: 0.5 } }], frameWidth: 1920, frameHeight: 1080, atlas: ATLAS, startX: 0.1, durationMs: 1000 }), /Presenter movement needs/);
});

test("all atlas sets share the floor anchor and turn and walk keep one effective height", () => {
  const plan = timeline();
  const sets = Object.values(plan.presenter.sets);
  for (const set of sets) assert.ok(Math.abs(set.footY - plan.presenter.floorY) <= 1);
  assert.ok(Math.abs(plan.presenter.sets.turn.effectiveFigureHeight - plan.presenter.sets.walk.effectiveFigureHeight) / plan.presenter.sets.turn.effectiveFigureHeight <= 0.01);
  assert.equal(plan.presenter.figureHeight, 1080 * PRESENTER_REST_HEIGHT_RATIO);
});

test("right windows use a mirrored pointing pose and left windows use the original pose", () => {
  const plan = timeline();
  assert.deepEqual({ pose: plan.beats[0].gesture.pose, mirrored: plan.beats[0].gesture.mirrored }, { pose: "pointLeft", mirrored: true });
  assert.deepEqual({ pose: plan.beats[1].gesture.pose, mirrored: plan.beats[1].gesture.mirrored }, { pose: "pointLeft", mirrored: false });
  assert.match(renderPresenterMarkup({ timeline: plan, atlas: ATLAS, beats: BEATS }), /data-layer-id="presenter-g-1"[^>]*scaleX\(-1\)/);
});

test("a window nearly above the presenter selects the raised-hand pose", () => {
  const plan = buildPresenterTimeline({
    atlas: ATLAS, frameWidth: 1920, frameHeight: 1080, startX: 0.5, durationMs: 2000,
    beats: [{ atMs: 0, moveTo: 0.5, window: { x: 0.54, y: 0.2 } }]
  });
  assert.deepEqual({ pose: plan.beats[0].gesture.pose, mirrored: plan.beats[0].gesture.mirrored }, { pose: "handUp", mirrored: false });
});

test("presenter windows never exceed 40 percent of the frame and type scales from height", () => {
  for (const width of [360, 1080, 1920, 3840]) {
    const height = Math.round(width * 9 / 16);
    const plan = buildPresenterTimeline({ beats: BEATS, frameWidth: width, frameHeight: height, atlas: ATLAS });
    for (const beat of plan.beats) assert.ok(beat.window.width <= width * PRESENTER_MAX_WINDOW_WIDTH_RATIO);
  }
  assert.match(presenterStageCss({ timeline: timeline() }), /font-size:34\.000px/);
});

test("presenter, windows, and wrist links remain inside the frame", () => {
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
  assert.match(markup, /data-layer-id="presenter-walk-11"/);
  assert.match(presenterStageCss({ timeline: plan }), /clip-path:inset/);
});

test("a missing presenter atlas produces a clear error", () => {
  assert.throws(() => loadPresenterAtlas("kael", { assetsRoot: "/tmp/hermest-board-test-no-presenter-atlas" }), /Presenter atlas is missing for "kael"/);
  assert.throws(() => buildSceneMarkup({
    scene: { title: "Ведущий", narration: "Ведущий объясняет.", sceneData: { presenter: { id: "missing_presenter_test", startX: 0.5 }, beats: [] } },
    sceneIndex: 0, sceneTitles: ["Ведущий"], brief: { topic: "Проверка", language: "ru" }, width: 1920, height: 1080, seed: 1, archetype: "presenter", role: "body"
  }), /Presenter atlas is missing for "missing_presenter_test"/);
});
