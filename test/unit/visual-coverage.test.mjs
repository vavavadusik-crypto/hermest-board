import assert from "node:assert/strict";
import test from "node:test";

import { summarizeCoverage } from "../../scripts/check-visual-coverage.mjs";

const scenes = count => Array.from({ length: count }, (_value, index) => ({ id: `scene-${index}` }));

test("a run where every provider failed reports zero coverage", () => {
  // Ровно тот случай, что уехал пользователю: pollinations ответил 500 на все
  // сцены, рендер отдал слайд-шоу и отчитался успехом.
  const summary = summarizeCoverage({
    scenes: scenes(6),
    footage: Array.from({ length: 5 }, (_value, index) => ({
      sceneIndex: index + 1,
      assetType: "deterministic"
    })),
    warnings: ["scene 2: pollinations-image failed: ... status 500"]
  });

  assert.equal(summary.eligible, 5);
  assert.equal(summary.live, 0);
  assert.equal(summary.liveRatio, 0);
  assert.deepEqual(summary.byType, { deterministic: 5 });
  assert.equal(summary.warnings.length, 1);
});

test("generated images count as live visuals but not as stock footage", () => {
  const summary = summarizeCoverage({
    scenes: scenes(6),
    footage: Array.from({ length: 5 }, (_value, index) => ({
      sceneIndex: index + 1,
      assetType: "generated-image"
    }))
  });

  assert.equal(summary.liveRatio, 1);
  assert.equal(summary.footageRatio, 0);
});

test("moving stock footage counts towards both ratios", () => {
  const summary = summarizeCoverage({
    scenes: scenes(6),
    footage: [
      { sceneIndex: 1, assetType: "stock-footage" },
      { sceneIndex: 2, assetType: "stock-footage" },
      { sceneIndex: 3, assetType: "stock-footage" },
      { sceneIndex: 4, assetType: "generated-image" },
      { sceneIndex: 5, assetType: "deterministic" }
    ]
  });

  assert.equal(summary.stockFootage, 3);
  assert.equal(summary.footageRatio, 3 / 5);
  assert.equal(summary.liveRatio, 4 / 5);
});

test("the title scene is excluded — the pipeline never gives it a background", () => {
  const summary = summarizeCoverage({
    scenes: scenes(4),
    footage: [
      { sceneIndex: 0, assetType: "deterministic" },
      { sceneIndex: 1, assetType: "stock-footage" },
      { sceneIndex: 2, assetType: "stock-footage" },
      { sceneIndex: 3, assetType: "stock-footage" }
    ]
  });

  assert.equal(summary.eligible, 3);
  assert.equal(summary.liveRatio, 1, "титульная сцена не должна портить статистику");
});

test("a manifest with no footage at all does not divide by zero", () => {
  const summary = summarizeCoverage({ scenes: [], footage: [] });

  assert.equal(summary.eligible, 0);
  assert.equal(summary.liveRatio, 0);
  assert.equal(summary.footageRatio, 0);
});
