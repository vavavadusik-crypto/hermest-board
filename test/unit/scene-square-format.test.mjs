// Квадрат 1:1 — третий формат кадра. Его беда не в ширине, а в высоте: при той
// же высоте, что у 16:9, макет собирается вертикально, как в 9:16, но высоты у
// него в 1.8 раза меньше. Эти проверки стерегут именно это — что фигура сцены
// вместе с текстом помещается в сцену и не наезжает ни на шапку, ни на ряд
// точек прогресса. Дефекты такого рода тесты раньше не ловили: они находились
// только глазами на отрендеренном кадре.
import assert from "node:assert/strict";
import test from "node:test";

import { getPlatformRecipe } from "../../src/domain/platform-recipes.js";
import { resolveSceneLayout } from "../../src/media/scene-design.js";
import { buildSceneMarkup } from "../../src/media/scene-markup.js";

const SQUARE = getPlatformRecipe("instagram_feed");
const VERTICAL = getPlatformRecipe("youtube_shorts");
const HORIZONTAL = getPlatformRecipe("youtube_video");

const SCENE = Object.freeze({
  title: "Один мастер, три формата",
  narration: "Горизонталь, вертикаль и квадрат считаются из одной раскадровки за 94 секунды.",
  durationMs: 5200
});

const SCENE_TITLES = ["Вход", "Разбор", "Итог"];

function layoutOf(recipe) {
  return resolveSceneLayout({ width: recipe.width, height: recipe.height, safeZones: recipe.safeZones });
}

function markupOf(recipe, archetype) {
  return buildSceneMarkup({
    scene: SCENE,
    sceneIndex: 1,
    sceneTitles: SCENE_TITLES,
    brief: { topic: "Как Hermest Board собирает ролик", language: "ru" },
    width: recipe.width,
    height: recipe.height,
    seed: 11,
    safeZones: recipe.safeZones,
    archetype,
    role: "body"
  });
}

test("the square frame is treated as narrow, the same way 9:16 is", () => {
  const square = layoutOf(SQUARE);
  assert.equal(square.aspectRatio, 1);
  assert.equal(square.isNarrow, true, "боковые композиции в квадрат не влезают");
  assert.equal(square.isVertical, false, "квадрат не выше своей ширины — это разные признаки");

  assert.equal(layoutOf(VERTICAL).isNarrow, true);
  assert.equal(layoutOf(HORIZONTAL).isNarrow, false, "16:9 остаётся широким — старые макеты не меняются");
});

test("the burned caption band stays inside the square frame", () => {
  const { subtitle, height, captionHeight } = layoutOf(SQUARE);

  assert.ok(subtitle.marginAss > 0);
  assert.ok(subtitle.fontSizeAss > 0);
  assert.ok(captionHeight < height * 0.25, `полоса субтитров съела ${captionHeight}px из ${height}px кадра`);
  assert.ok(subtitle.marginPx + subtitle.textHeight <= height, "строка субтитра уезжает за нижнюю кромку");
});

test("the format trio fits inside the stage, wrapped or not", () => {
  for (const recipe of [SQUARE, VERTICAL]) {
    const layout = layoutOf(recipe);
    const markup = markupOf(recipe, "format-trio");
    const frames = [...markup.matchAll(/class="ft-frame" style="width:(\d+)px;height:(\d+)px/gu)]
      .map(([, width, height]) => ({ width: Number(width), height: Number(height) }));

    assert.equal(frames.length, 3, `${recipe.id}: три формата — три рамки`);

    // Ряд переносится, когда не влезает в ширину, и тогда блок становится вдвое
    // выше — в квадрате именно это выбрасывало нижнюю рамку за кадр. Считаем
    // высоту так, как её посчитает flex-wrap, и требуем, чтобы под заголовок
    // осталась хотя бы треть сцены.
    const rows = [];
    let row = { width: 0, height: 0 };
    for (const frame of frames) {
      if (row.width > 0 && row.width + frame.width > layout.stageWidth) {
        rows.push(row);
        row = { width: 0, height: 0 };
      }
      row.width += frame.width;
      row.height = Math.max(row.height, frame.height);
    }
    rows.push(row);
    const blockHeight = rows.reduce((sum, current) => sum + current.height, 0);

    assert.ok(
      blockHeight <= layout.stageHeight * 0.66,
      `${recipe.id}: ${rows.length} ряд(а) рамок заняли ${blockHeight}px из сцены ${Math.round(layout.stageHeight)}px`
    );
  }

  // В квадрате ряд обязан быть один: второй ряд туда физически не помещается.
  const squareLayout = layoutOf(SQUARE);
  const squareFrames = [...markupOf(SQUARE, "format-trio").matchAll(/class="ft-frame" style="width:(\d+)px/gu)]
    .map(([, width]) => Number(width));
  assert.ok(
    squareFrames.reduce((sum, width) => sum + width, 0) <= squareLayout.stageWidth,
    "рамки в квадрате переносятся на вторую строку"
  );
});

test("the device mockup leaves the square room for its own headline", () => {
  for (const recipe of [SQUARE, VERTICAL]) {
    const layout = layoutOf(recipe);
    const markup = markupOf(recipe, "device-mockup");
    const screen = markup.match(/\.dv-screen \{[^}]*height:\s*(\d+)px/u);

    assert.ok(screen, `${recipe.id}: экран устройства не найден в разметке`);
    // 9:16 вытянут вверх и телефон там помещается по-прежнему; квадрату нужен
    // предел, иначе устройство съедает всю сцену вместе с заголовком.
    const budget = recipe === SQUARE ? 0.56 : 0.84;
    assert.ok(
      Number(screen[1]) <= layout.stageHeight * budget,
      `${recipe.id}: экран ${screen[1]}px против сцены ${Math.round(layout.stageHeight)}px`
    );
  }
});

test("the counter ring does not push its caption onto the progress dots", () => {
  for (const recipe of [SQUARE, VERTICAL]) {
    const layout = layoutOf(recipe);
    const markup = markupOf(recipe, "stat-highlight");
    const ring = markup.match(/class="sh-ring" width="(\d+)"/u);

    assert.ok(ring, `${recipe.id}: кольцо счётчика не найдено`);
    assert.ok(
      Number(ring[1]) <= Math.round(layout.stageHeight * 0.55),
      `${recipe.id}: кольцо ${ring[1]}px не оставило места надписи под ним`
    );
  }
});

// Экранирование, отсутствие внешних ссылок и байт-в-байт повторяемость для
// квадрата проверяет общий набор в scene-archetypes.test.mjs: формат добавлен
// в его список FORMATS, поэтому каждый архетип получает те же проверки, что
// 16:9 и 9:16, без дублирования здесь.
