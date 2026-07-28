import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNarrationScript,
  buildStoryboard,
  reconcileStoryboardWithSceneDurations
} from "../../src/domain/content-pipeline.js";

const board = {
  title: "История искусственного интеллекта",
  cards: [
    {
      id: "ending",
      x: 700,
      y: 500,
      title: "Что дальше",
      text: "ИИ становится повседневным инструментом.",
      sourceRefs: ["source-2"]
    },
    {
      id: "opening",
      x: 100,
      y: 100,
      title: "Начало",
      text: "Первые идеи появились задолго до современных моделей.",
      sourceRefs: ["source-1"]
    },
    {
      id: "middle",
      x: 500,
      y: 100,
      title: "Новый этап",
      text: "Машинное обучение изменило подход к программированию.",
      sourceRefs: []
    }
  ]
};

test("buildStoryboard orders current board cards spatially and preserves source lineage", () => {
  const storyboard = buildStoryboard(board, {
    minSceneDurationMs: 2500,
    wordsPerMinute: 150
  });

  assert.equal(storyboard.schemaVersion, 1);
  assert.equal(storyboard.title, board.title);
  assert.deepEqual(storyboard.scenes.map(scene => scene.cardId), [
    "opening",
    "middle",
    "ending"
  ]);
  assert.equal(storyboard.scenes[0].id, "scene-opening");
  assert.equal(storyboard.scenes[0].narration, "Начало. Первые идеи появились задолго до современных моделей.");
  assert.deepEqual(storyboard.scenes[0].sourceRefs, ["source-1"]);
  assert.ok(storyboard.scenes.every(scene => scene.durationMs >= 2500));
});

test("buildNarrationScript is derived only from scene content without hidden boilerplate", () => {
  const script = buildNarrationScript(buildStoryboard(board));

  assert.match(script, /^Начало\. Первые идеи/);
  assert.match(script, /Что дальше\. ИИ становится/);
  assert.doesNotMatch(script, /История искусственного интеллекта|Hermest|оболочк/i);
});

test("buildStoryboard rejects a board without renderable cards", () => {
  assert.throws(
    () => buildStoryboard({ title: "Пусто", cards: [] }),
    /at least one renderable card/
  );
});

test("per-scene reconciliation keeps every scene at least as long as its narration", () => {
  const reconciled = reconcileStoryboardWithSceneDurations({
    schemaVersion: 1,
    scenes: [
      { id: "a", durationMs: 2500 },
      { id: "b", durationMs: 3000 }
    ]
  }, [4100, 900]);

  assert.deepEqual(reconciled.scenes.map(scene => scene.narrationDurationMs), [4100, 900]);
  assert.deepEqual(reconciled.scenes.map(scene => scene.durationMs), [4500, 1300]);
  assert.ok(reconciled.scenes.every(scene => scene.durationMs >= scene.narrationDurationMs));
  assert.equal(reconciled.measuredDurationMs, 5800);
});

test("storyboard enforces bounded card and narration input", () => {
  assert.throws(
    () => buildStoryboard({
      title: "Too many",
      cards: Array.from({ length: 201 }, (_, index) => ({ id: `c-${index}`, text: "ok" }))
    }),
    /card limit/
  );
  assert.throws(
    () => buildStoryboard({ title: "Too long", cards: [{ id: "a", text: "x".repeat(20001) }] }),
    /text limit/
  );
  assert.throws(
    () => buildStoryboard({ title: "Bad\u0000title", cards: [{ id: "a", text: "ok" }] }),
    /control characters/
  );
  assert.throws(
    () => buildStoryboard({ schemaVersion: 99, title: "Future", cards: [{ id: "a", text: "ok" }] }),
    /Unsupported board schemaVersion/
  );
});

test("storyboard assigns sorted order and rejects normalized id collisions", () => {
  const storyboard = buildStoryboard({
    title: "Order",
    cards: [
      { id: "later", x: 0, y: 100, text: "Later" },
      { id: "first", x: 0, y: 0, text: "First" }
    ]
  });
  assert.deepEqual(storyboard.scenes.map(scene => scene.order), [1, 2]);
  assert.throws(
    () => buildStoryboard({
      title: "Collision",
      cards: [
        { id: "A B", x: 0, y: 0, text: "One" },
        { id: "a-b", x: 1, y: 0, text: "Two" }
      ]
    }),
    /normalized card id collision/
  );
});

test("per-scene reconciliation honors custom padding and the practical minimum", () => {
  const shortScene = { schemaVersion: 1, scenes: [{ id: "a", durationMs: 1 }] };

  const clamped = reconcileStoryboardWithSceneDurations(shortScene, [100], { paddingMs: 50 });
  assert.equal(clamped.scenes[0].durationMs, 250);

  const unpadded = reconcileStoryboardWithSceneDurations(shortScene, [1000], { paddingMs: 0 });
  assert.equal(unpadded.scenes[0].durationMs, 1000);
});

test("per-scene reconciliation fails closed on mismatched or invalid measurements", () => {
  const storyboard = { schemaVersion: 1, scenes: [{ id: "a", durationMs: 1000 }] };
  assert.throws(() => reconcileStoryboardWithSceneDurations(storyboard, []), TypeError);
  assert.throws(() => reconcileStoryboardWithSceneDurations(storyboard, [0]), TypeError);
  assert.throws(() => reconcileStoryboardWithSceneDurations(storyboard, [Number.NaN]), TypeError);
  assert.throws(() => reconcileStoryboardWithSceneDurations({ scenes: [] }, []), TypeError);
});

test("legacy project without motion migrates to the existing depth/calm render profile", () => {
  const legacyProject = {
    schemaVersion: 4,
    title: "Старый проект",
    brief: { language: "ru", topic: "тема" },
    cards: [{ id: "intro", x: 0, y: 0, title: "Вход", text: "Сцена без нового поля." }]
  };
  const storyboard = buildStoryboard(legacyProject);

  assert.deepEqual(storyboard.motion, { depth: "depth", character: "calm" });
  assert.deepEqual(
    buildStoryboard({ ...legacyProject, brief: { ...legacyProject.brief, motion: { depth: "space", character: "lively" } } }).motion,
    { depth: "space", character: "lively" }
  );
});
