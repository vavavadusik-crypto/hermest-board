// Полоса субтитров: одна геометрия для ffmpeg и для сцены.
//
// Числа-оракулы ниже не выведены из формулы, а ЗАМЕРЕНЫ на реальном ffmpeg
// (8.0.1, libass) тем же фильтром, что строит ffmpeg-args.js: субтитр выжигался
// на чёрный кадр, затем в сыром gray-буфере искалась верхняя и нижняя строка
// чернил. Команда воспроизведения — в шапке src/media/subtitle-band.js.

import assert from "node:assert/strict";
import test from "node:test";

import { getPlatformRecipe } from "../../src/domain/platform-recipes.js";
import { buildVideoRenderArgs } from "../../src/media/ffmpeg-args.js";
import { resolveSceneLayout } from "../../src/media/scene-design.js";
import { ASS_PLAY_RES_Y, resolveSubtitleBand, subtitleForceStyle } from "../../src/media/subtitle-band.js";

const RECIPES = Object.freeze(["youtube_video", "youtube_shorts", "tiktok", "instagram_reels"]);

test("ASS units, not pixels: the virtual canvas is 384x288", () => {
  assert.equal(ASS_PLAY_RES_Y, 288);
  // 1080p: одна ASS-единица = 3.75px, поэтому 54px safe zone = 15 единиц.
  assert.equal(resolveSubtitleBand({ width: 1920, height: 1080, marginBottom: 54 }).marginAss, 15);
  // 1920p: одна ASS-единица = 6.67px, поэтому 300px safe zone = 45 единиц.
  assert.equal(resolveSubtitleBand({ width: 1080, height: 1920, marginBottom: 300 }).marginAss, 45);
});

test("burned subtitle geometry matches what ffmpeg actually draws", () => {
  // Замер 1920x1080, MarginV=15: чернила в строках 912..1022, нижний зазор 57px,
  // полоса от низа 168px.
  const horizontal = resolveSubtitleBand({ width: 1920, height: 1080, marginBottom: 54 });
  assert.equal(horizontal.marginPx, 56, "отступ строки от нижней кромки");
  assert.equal(horizontal.fontPx, 60, "кегль на 1080p — исторические 60px");
  assert.equal(horizontal.fontSizeAss, 16, "кегль по умолчанию ASS не меняется для 16:9");
  assert.ok(horizontal.bandHeight >= 168, `оценка ${horizontal.bandHeight} меньше замеренных 168px`);
  assert.ok(horizontal.bandHeight <= 168 + 24, "оценка полосы завышена больше чем на 24px");

  // Замер 1080x1920, MarginV=45, Fontsize=5: чернила 1558..1619, нижний зазор
  // 300px, полоса от низа 362px. С кеглем по умолчанию (16) текст раздувался до
  // 107px, двухстрочная реплика переносилась в четыре строки и занимала 410px.
  const vertical = resolveSubtitleBand({ width: 1080, height: 1920, marginBottom: 300 });
  assert.equal(vertical.marginPx, 300);
  assert.equal(vertical.fontPx, 34, "кегль считается от ширины кадра, а не от высоты");
  assert.equal(vertical.fontSizeAss, 5);
  assert.ok(vertical.bandHeight >= 362, `оценка ${vertical.bandHeight} меньше замеренных 362px`);
  assert.ok(vertical.bandHeight <= 362 + 24);
});

test("force_style carries the same geometry the scene reserves", () => {
  for (const recipeId of RECIPES) {
    const recipe = getPlatformRecipe(recipeId);
    const band = resolveSubtitleBand({
      width: recipe.width,
      height: recipe.height,
      marginBottom: recipe.safeZones.bottom,
      maxLines: recipe.subtitleLayout.maxLines
    });
    const style = subtitleForceStyle({
      width: recipe.width,
      height: recipe.height,
      marginBottom: recipe.safeZones.bottom,
      maxLines: recipe.subtitleLayout.maxLines
    });
    assert.equal(style, `FontName=DejaVu Sans,Alignment=2,MarginV=${band.marginAss},Fontsize=${band.fontSizeAss}`);

    const args = buildVideoRenderArgs({
      audioFile: "/tmp/hermest-board-run/narration.wav",
      subtitleFile: "/tmp/hermest-board-run/narration.srt",
      outputFile: "/tmp/hermest-board-run/out.mp4",
      durationSeconds: 5,
      sceneTitleFiles: [],
      recipe
    });
    const filter = args[args.indexOf("-vf") + 1];
    assert.ok(filter.includes(`force_style='${style}'`), `${recipeId}: фильтр разошёлся со сценой`);
  }
});

test("REGRESSION: burned subtitles never overlap the scene stage", () => {
  for (const recipeId of RECIPES) {
    const recipe = getPlatformRecipe(recipeId);
    const layout = resolveSceneLayout({
      width: recipe.width,
      height: recipe.height,
      safeZones: recipe.safeZones
    });

    const stageBottomY = recipe.height - layout.padBottom;
    const subtitleTopY = recipe.height - layout.captionHeight;
    assert.ok(
      stageBottomY <= subtitleTopY,
      `${recipeId}: сцена доходит до ${stageBottomY}px, субтитр начинается на ${subtitleTopY}px`
    );

    // Ряд точек прогресса живёт между сценой и субтитром, не пересекая ни то,
    // ни другое.
    const progressTopY = recipe.height - layout.progressBottom - 10;
    assert.ok(progressTopY >= stageBottomY, `${recipeId}: прогресс залез в сцену`);
    assert.ok(recipe.height - layout.progressBottom <= subtitleTopY, `${recipeId}: прогресс залез в субтитр`);

    // И полоса действительно резервируется, а не «съедается» safe zone.
    assert.ok(layout.padBottom >= layout.captionHeight, `${recipeId}: полоса субтитров не зарезервирована`);
    assert.ok(layout.padBottom >= recipe.safeZones.bottom, `${recipeId}: нарушена нижняя safe zone`);
  }
});

test("the reserved band is no longer a flat 16% guess", () => {
  const recipe = getPlatformRecipe("youtube_video");
  const layout = resolveSceneLayout({
    width: recipe.width,
    height: recipe.height,
    safeZones: recipe.safeZones
  });
  assert.notEqual(layout.captionHeight, Math.round(recipe.height * 0.16));
  assert.equal(layout.captionHeight, layout.subtitle.bandHeight);
});

test("subtitle band validates its input", () => {
  assert.throws(() => resolveSubtitleBand({ width: 0, height: 1080, marginBottom: 54 }), TypeError);
  assert.throws(() => resolveSubtitleBand({ width: 1920, height: -1, marginBottom: 54 }), TypeError);
  assert.throws(() => resolveSubtitleBand({ width: 1920, height: 1080, marginBottom: -1 }), TypeError);
  assert.throws(() => resolveSubtitleBand({ width: 1920, height: 1080, marginBottom: 54, maxLines: 0 }), TypeError);
});
