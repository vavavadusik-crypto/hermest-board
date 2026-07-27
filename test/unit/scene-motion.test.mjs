// Камера сцены. Главное здесь не красота хода, а обещание: движение не имеет
// права вытолкнуть текст за защитную зону. Один раз этот класс ошибки уже
// стоил нам реплик, уехавших под интерфейс площадки, — поэтому инвариант
// проверяется арифметикой, а не глазом.

import assert from "node:assert/strict";
import test from "node:test";

import { buildCameraCss, selectCameraMove, stageCameraKeyframes } from "../../src/media/scene-motion.js";
import { buildSceneMarkup } from "../../src/media/scene-markup.js";

const MOVES = [
  { sceneIndex: 0, role: "opening" },
  { sceneIndex: 1, role: "body" },
  { sceneIndex: 2, role: "body" },
  { sceneIndex: 3, role: "body" },
  { sceneIndex: 4, role: "body" },
  { sceneIndex: 5, role: "closing" }
];

test("the stage never leaves its rectangle at any point of the move", () => {
  for (const seed of [1, 7, 42, 999]) {
    for (const { sceneIndex, role } of MOVES) {
      const move = selectCameraMove({ sceneIndex, role, seed });
      for (const point of stageCameraKeyframes(move)) {
        assert.ok(point.scale <= 1 + 1e-9, `${move.id}: масштаб ${point.scale} больше кадра`);
        // Сдвиг допустим ровно на тот запас, который оставил неполный масштаб.
        const slack = ((1 - point.scale) / 2) * 100 + 1e-9;
        assert.ok(Math.abs(point.x) <= slack, `${move.id}: сдвиг по x ${point.x}% при запасе ${slack}%`);
        assert.ok(Math.abs(point.y) <= slack, `${move.id}: сдвиг по y ${point.y}% при запасе ${slack}%`);
      }
    }
  }
});

test("every move actually moves, and the peak fills the frame exactly", () => {
  for (const { sceneIndex, role } of MOVES) {
    const move = selectCameraMove({ sceneIndex, role, seed: 1 });
    const [from, to] = stageCameraKeyframes(move);
    const travelled = Math.abs(to.scale - from.scale) + Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    assert.ok(travelled > 0.005, `${move.id}: ход камеры ${travelled} — это стояние на месте`);
    // Пик хода обязан быть ровно единицей: иначе кадр либо не дозаполнен, либо вылезает.
    assert.equal(Math.max(from.scale, to.scale), 1);
  }
});

test("the opening pushes in and the closing pulls back, whatever the seed", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    assert.equal(selectCameraMove({ sceneIndex: 0, role: "opening", seed }).id, "push-in");
    assert.equal(selectCameraMove({ sceneIndex: 9, role: "closing", seed }).id, "pull-back");
  }
});

test("neighbouring scenes do not repeat the same camera move", () => {
  for (const seed of [1, 3, 11]) {
    for (let index = 0; index < 8; index += 1) {
      const current = selectCameraMove({ sceneIndex: index, role: "body", seed });
      const next = selectCameraMove({ sceneIndex: index + 1, role: "body", seed });
      assert.notEqual(current.id, next.id, `сцены ${index} и ${index + 1} двигаются одинаково`);
    }
  }
});

test("background layers over-cover the frame so a drift cannot expose an edge", () => {
  const css = buildCameraCss({ sceneIndex: 1, role: "body", durationMs: 9000, seed: 2 });
  const scales = [...css.matchAll(/scale\((\d+\.\d+)\)/gu)].map(match => Number(match[1]));
  const backgroundScales = scales.filter(scale => scale > 1);
  assert.ok(backgroundScales.length >= 4, "фоновые слои обязаны быть крупнее кадра");
  for (const scale of backgroundScales) {
    assert.ok(scale >= 1.05, `фоновый слой ${scale} слишком мал, на краю появится щель`);
  }
});

test("the camera runs for exactly as long as the scene", () => {
  const css = buildCameraCss({ sceneIndex: 1, role: "body", durationMs: 9500, seed: 1 });
  assert.match(css, /animation: cam-stage 9\.500s/u);
  // Мгновенная сцена не даёт нулевую длительность: анимация с 0s не проигрывается.
  assert.match(buildCameraCss({ durationMs: 10 }), /animation: cam-stage 1\.200s/u);
  assert.match(buildCameraCss({ durationMs: 0 }), /animation: cam-stage 1\.200s/u);
});

test("the frozen frame equals the end of the move, not its start", () => {
  const scene = { id: "scene-01", title: "Тема", durationMs: 8000, text: "Короткий текст сцены." };
  const shared = {
    scene, sceneIndex: 1, sceneTitles: ["a", "b", "c"], brief: { language: "ru", topic: "тема" },
    width: 1920, height: 1080, seed: 5, safeZones: { top: 54, right: 96, bottom: 54, left: 96 }
  };
  const animated = buildSceneMarkup({ ...shared, animated: true });
  const still = buildSceneMarkup({ ...shared, animated: false });

  // Статичная разметка отличается ровно одним правилом — глушителем анимаций.
  assert.equal(still.replace("\n  * { animation: none !important; }", ""), animated);
  // Базовый стиль слоя — это конец хода: значит замороженный кадр показывает финал.
  const [, stageTransform] = animated.match(/\.stage \{ transform-origin: [^;]+; transform: ([^;]+);/u);
  const move = selectCameraMove({ sceneIndex: 1, role: "body", seed: 5 });
  const [, to] = stageCameraKeyframes(move);
  assert.ok(stageTransform.includes(`scale(${to.scale.toFixed(4)})`), `база слоя ${stageTransform} не равна финалу хода`);
});
