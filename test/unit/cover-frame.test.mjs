import assert from "node:assert/strict";
import test from "node:test";

import { resolveCoverFrameSeconds } from "../../src/domain/cover-frame.js";

const storyboardWith = (...sceneDurationsMs) => ({
  schemaVersion: 1,
  title: "Cover board",
  scenes: sceneDurationsMs.map((durationMs, index) => ({
    id: `scene-${index + 1}`,
    title: `Scene ${index + 1}`,
    narration: "Narration.",
    durationMs
  }))
});

test("cover frame is taken from the middle of the first scene", () => {
  assert.equal(
    resolveCoverFrameSeconds(storyboardWith(4000, 6000, 5000), { durationSeconds: 15 }),
    2
  );
  assert.equal(
    resolveCoverFrameSeconds(storyboardWith(3333, 4000), { durationSeconds: 7.333 }),
    1.667
  );
});

test("cover frame stays inside the clip by at least the edge margin", () => {
  // Сцена короче 0.2 c: середина ушла бы к самому началу, где кадр у энкодера
  // часто чёрный, — нижний кламп обязателен.
  assert.equal(resolveCoverFrameSeconds(storyboardWith(120), { durationSeconds: 9 }), 0.06);
  assert.equal(resolveCoverFrameSeconds(storyboardWith(80), { durationSeconds: 9 }), 0.05);

  // Первая сцена длиннее самого ролика (рассинхрон раскадровки и мастера):
  // момент обязан остаться внутри материала.
  assert.equal(resolveCoverFrameSeconds(storyboardWith(60000), { durationSeconds: 4 }), 2);
  const nearEnd = resolveCoverFrameSeconds(storyboardWith(4000), { durationSeconds: 0.5 });
  assert.ok(nearEnd >= 0.05 && nearEnd <= 0.45, `expected an in-window moment, got ${nearEnd}`);
});

test("cover frame falls back to the clip centre without usable scene timings", () => {
  assert.equal(resolveCoverFrameSeconds({ scenes: [] }, { durationSeconds: 8 }), 4);
  assert.equal(resolveCoverFrameSeconds({}, { durationSeconds: 8 }), 4);
  assert.equal(resolveCoverFrameSeconds(null, { durationSeconds: 8 }), 4);
  assert.equal(resolveCoverFrameSeconds(storyboardWith(undefined), { durationSeconds: 8 }), 4);
  assert.equal(resolveCoverFrameSeconds(storyboardWith(0), { durationSeconds: 8 }), 4);
  assert.equal(resolveCoverFrameSeconds(storyboardWith(-1000), { durationSeconds: 8 }), 4);
  assert.equal(resolveCoverFrameSeconds({ scenes: [{ durationMs: "not a number" }] }, { durationSeconds: 8 }), 4);
});

test("clips shorter than the two edge margins still yield a moment inside the clip", () => {
  assert.equal(resolveCoverFrameSeconds(storyboardWith(150), { durationSeconds: 0.15 }), 0.075);
  assert.equal(resolveCoverFrameSeconds(storyboardWith(100), { durationSeconds: 0.1 }), 0.05);
  assert.equal(resolveCoverFrameSeconds(storyboardWith(80), { durationSeconds: 0.08 }), 0.04);
  const tiny = resolveCoverFrameSeconds({ scenes: [] }, { durationSeconds: 0.02 });
  assert.ok(tiny > 0 && tiny < 0.02, `expected a moment inside a 0.02s clip, got ${tiny}`);
});

test("cover frame resolution is deterministic and rejects an unusable duration", () => {
  const storyboard = storyboardWith(4321, 2000);
  const first = resolveCoverFrameSeconds(storyboard, { durationSeconds: 12.5 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(resolveCoverFrameSeconds(storyboard, { durationSeconds: 12.5 }), first);
  }
  // Результат уходит в argv с тремя знаками — значение обязано быть ровно таким.
  assert.equal(first, Number(first.toFixed(3)));

  for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "abc", null, undefined]) {
    assert.throws(
      () => resolveCoverFrameSeconds(storyboard, { durationSeconds }),
      /positive durationSeconds/,
      `durationSeconds ${JSON.stringify(durationSeconds)} must be rejected`
    );
  }
  assert.throws(() => resolveCoverFrameSeconds(storyboard), /positive durationSeconds/);
});
