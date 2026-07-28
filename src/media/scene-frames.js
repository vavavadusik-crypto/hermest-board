import { createHash } from "node:crypto";
import { access, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { openSceneBrowser } from "./chrome-cdp.js";
import { isCompletePng } from "./png-header.js";
import { assertSafeGeneratedPath } from "./ffmpeg-args.js";
import { planSceneArchetypes } from "./scene-content.js";
import { buildSceneMarkup } from "./scene-markup.js";

const PRIVATE_FILE_MODE = 0o600;
const MAX_SCENES = 64;
// Сцена снимается целиком. Раньше снимались первые 2.8 с, а хвост клонировался
// (`tpad`) — внутреннее движение умирало на середине сцены, и ambient-слои
// архетипов не имели смысла. Кап держит цену: 1800 кадров — это 30 с при 60fps,
// дальше секвенция снова замирает на последнем снятом кадре.
const MAX_BUILD_FRAMES = 1800;

export async function describeSceneComposerAvailability({ env = process.env, accessImpl = access } = {}) {
  const binaryPath = resolveChromeBinaryPathFromEnv(env);
  try {
    await accessImpl(binaryPath, fsConstants.X_OK);
    return { status: "executable", binaryPath };
  } catch {
    return {
      status: "missing",
      binaryPath,
      reason: "Chrome binary is not executable; falling back to legacy color scenes"
    };
  }
}

function resolveChromeBinaryPathFromEnv(env) {
  const configured = typeof env.HERMEST_CHROME_PATH === "string" ? env.HERMEST_CHROME_PATH.trim() : "";
  if (configured) {
    return assertSafeGeneratedPath(configured);
  }
  return "/usr/bin/google-chrome";
}

/**
 * Секвенция, которую сцена обещает манифесту, обязана существовать на диске
 * целиком и подряд.
 *
 * Иначе потеря кадров молчалива по построению: `image2` читает файлы подряд и
 * останавливается на первой дырке, `tpad` дотягивает сегмент только на ту
 * недостачу, которая заявлена в `sequenceFrameCount`, а ffmpeg завершается
 * кодом 0 и без единого предупреждения. Замерено на копии реального монтажа
 * (ffmpeg 6.1.1, десять сцен, 7304 кадра): убрали 663 кадра в середине второй
 * сцены — получили 110.683 с вместо 121.733 и ни одной строки в stderr.
 *
 * Проверка превращает «ролик почему-то короче» в «сцена N недосчиталась кадра
 * K» — то есть в факт, с которым можно работать.
 */
export async function assertSequenceComplete({ pattern, frameCount, statImpl = stat }) {
  const missing = [];
  const empty = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const file = pattern.replace("%04d", String(frameIndex).padStart(4, "0"));
    try {
      const stats = await statImpl(file);
      if (!stats.size) empty.push(frameIndex);
    } catch {
      missing.push(frameIndex);
    }
    // Список нужен для диагноза, а не для полноты: первых нескольких индексов
    // хватает, чтобы понять, где рвётся, и не раздувать сообщение об ошибке.
    if (missing.length + empty.length >= 5) break;
  }
  if (!missing.length && !empty.length) return;
  const details = [
    missing.length ? `нет кадров: ${missing.join(", ")}` : "",
    empty.length ? `пустые кадры: ${empty.join(", ")}` : ""
  ].filter(Boolean).join("; ");
  throw new Error(
    `Scene frame sequence ${pattern} is incomplete (${frameCount} expected) — ${details}`
  );
}

function resolveBuildFrameLimit(env, explicitLimit) {
  if (explicitLimit !== undefined) {
    const limit = Number(explicitLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BUILD_FRAMES) {
      throw new RangeError(`buildFrameLimit must be within 1..${MAX_BUILD_FRAMES}`);
    }
    return limit;
  }
  const configured = Number(env?.HERMEST_SCENE_BUILD_FRAME_LIMIT);
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= MAX_BUILD_FRAMES) {
    return configured;
  }
  return null;
}

/**
 * Снимает build-in секвенцию каждой сцены из ОДНОГО headless-браузера через CDP.
 * Раньше на каждый кадр стартовал отдельный процесс chrome — это и было главным
 * узким местом рендера. Кадр по-прежнему снимается со свежего документа на
 * точном виртуальном времени, поэтому картинка не меняется ни на бит.
 */
export async function composeSceneFrames({
  storyboard,
  brief,
  recipe,
  runDir,
  seed,
  signal,
  brollClips = [],
  backgroundImages = [],
  buildFrameLimit,
  env = process.env,
  browserFactory = openSceneBrowser
} = {}) {
  const scenes = storyboard?.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > MAX_SCENES) {
    throw new RangeError(`Scene composition requires 1..${MAX_SCENES} scenes`);
  }
  const safeRunDir = assertSafeGeneratedPath(runDir);
  const width = positiveInteger(recipe?.width, "recipe.width");
  const height = positiveInteger(recipe?.height, "recipe.height");
  const fps = positiveInteger(recipe?.fps, "recipe.fps");
  const frameLimit = resolveBuildFrameLimit(env, buildFrameLimit);
  const profileDir = path.join(safeRunDir, "chrome-profile");
  const sceneTitles = scenes.map(scene => String(scene.title || ""));
  // Архетипы выбираются по всей раскадровке сразу: только так соседние сцены
  // гарантированно не повторяют композицию друг друга.
  const archetypePlan = planSceneArchetypes(scenes);
  const frames = [];

  const browser = await browserFactory({ profileDir, width, height, signal });
  // Один процесс на весь рендер: закрытие обязано случиться и на ошибке,
  // иначе headless-браузер утечёт вместе с профилем.
  try {
    for (const [sceneIndex, scene] of scenes.entries()) {
      const sceneTag = String(sceneIndex + 1).padStart(3, "0");
      const markupFile = path.join(safeRunDir, `scene-${sceneTag}.html`);
      const brollClip = brollClips[sceneIndex] || null;
      const backgroundImage = brollClip ? null : backgroundImages[sceneIndex] || null;
      const hasMovingBackground = Boolean(brollClip || backgroundImage);
      const markup = buildSceneMarkup({
        scene,
        sceneIndex,
        sceneTitles,
        brief,
        width,
        height,
        seed,
        safeZones: recipe?.safeZones,
        archetype: archetypePlan[sceneIndex]?.archetype,
        role: archetypePlan[sceneIndex]?.role,
        mode: hasMovingBackground ? "overlay" : "opaque"
      });
      await writeFile(markupFile, markup, { encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE });

      const sceneSeconds = Number(scene.durationMs) / 1000;
      let frameCount = Math.min(
        MAX_BUILD_FRAMES,
        Math.max(Math.round(sceneSeconds * fps), 1)
      );
      if (frameLimit) frameCount = Math.min(frameCount, frameLimit);

      await browser.openScene({ htmlFile: markupFile, transparent: hasMovingBackground });
      const lastFrameIndex = frameCount - 1;
      const lastFrameFile = path.join(
        safeRunDir,
        `scene-${sceneTag}-f${String(lastFrameIndex).padStart(4, "0")}.png`
      );
      let lastFrameBytes = null;
      // Кадры сцены независимы (каждый — свежий документ на своём виртуальном
      // времени), поэтому раздаём их вкладкам пула. Порядок гонки на результат
      // не влияет: имя файла определяется индексом кадра.
      let nextFrameIndex = 0;
      let sequenceFailed = false;
      const workerCount = Math.max(1, Math.min(browser.workerCount || 1, frameCount));
      await Promise.all(Array.from({ length: workerCount }, (_unused, workerIndex) => (async () => {
        try {
          for (;;) {
            const frameIndex = nextFrameIndex;
            nextFrameIndex += 1;
            if (frameIndex >= frameCount || sequenceFailed) return;
            signal?.throwIfAborted();
            const frameFile = path.join(safeRunDir, `scene-${sceneTag}-f${String(frameIndex).padStart(4, "0")}.png`);
            const frameBytes = await captureCompleteFrame({
              browser,
              timeMs: Math.round((frameIndex * 1000) / fps),
              workerIndex,
              label: `${sceneTag}-f${frameIndex}`
            });
            await writeFile(frameFile, frameBytes, { flag: "wx", mode: PRIVATE_FILE_MODE });
            if (frameIndex === lastFrameIndex) lastFrameBytes = frameBytes;
          }
        } catch (error) {
          sequenceFailed = true;
          throw error;
        }
      })()));

      const sequencePattern = path.join(safeRunDir, `scene-${sceneTag}-f%04d.png`);
      await assertSequenceComplete({ pattern: sequencePattern, frameCount });

      frames.push({
        path: lastFrameFile,
        sequencePattern,
        sequenceFrameCount: frameCount,
        sequenceFps: fps,
        durationSeconds: sceneSeconds,
        markupSha256: createHash("sha256").update(markup).digest("hex"),
        frameSha256: createHash("sha256").update(lastFrameBytes).digest("hex"),
        ...(brollClip ? { brollPath: brollClip.path } : {}),
        ...(backgroundImage ? { backgroundImagePath: backgroundImage.path } : {})
      });
      await rm(markupFile, { force: true });
    }
  } finally {
    await browser.close();
  }
  // Chrome забирает дочерние процессы не мгновенно: пока они дописывают профиль,
  // рекурсивное удаление ловит ENOTEMPTY. Ретраи ждут затишья.
  await rm(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  // Единственный запущенный процесс — единственная команда-доказательство.
  // Содержимое секвенций пришпилено markupSha256 + frameSha256 в frames[],
  // а времена кадров выводятся из sequenceFps/sequenceFrameCount.
  const commands = [{ id: "scene-browser", tool: "chrome", argv: browser.launchArgv }];
  return { frames, commands, composer: "scene-markup@2" };
}

// Обрезанный скриншот — не повод хоронить весь рендер: на нагруженной машине
// это разовая осечка, и повторный снимок того же виртуального времени обязан
// дать тот же кадр (документ свежий, время фиксировано). Поэтому сначала
// повтор, и только потом отказ — с точным именем кадра, а не «что-то пошло не
// так на сборке».
const FRAME_CAPTURE_ATTEMPTS = 3;

export async function captureCompleteFrame({ browser, timeMs, workerIndex, label }) {
  let lastSize = null;
  for (let attempt = 1; attempt <= FRAME_CAPTURE_ATTEMPTS; attempt += 1) {
    const frameBytes = await browser.captureFrame(timeMs, workerIndex);
    if (isCompletePng(frameBytes)) return frameBytes;
    lastSize = Buffer.isBuffer(frameBytes) ? frameBytes.length : null;
  }
  throw new TypeError(
    `Scene frame ${label} came back as an incomplete PNG after ${FRAME_CAPTURE_ATTEMPTS} attempts`
    + `${lastSize === null ? "" : ` (last attempt: ${lastSize} bytes without the IEND trailer)`}`
  );
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return number;
}
