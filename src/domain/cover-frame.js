// Обложка снимается из середины первой сцены: это титульная сцена ролика, её
// кадр специально сделан читаемым (крупный заголовок, спокойный фон), поэтому
// он же — лучший статичный превью-кадр. Момент считается доменом, а не
// медиа-слоем: правило продуктовое, а не свойство ffmpeg.
const COVER_FRAME_EDGE_MARGIN_SECONDS = 0.05;

export function resolveCoverFrameSeconds(storyboard, { durationSeconds } = {}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("resolveCoverFrameSeconds requires a positive durationSeconds");
  }
  const firstSceneSeconds = firstSceneDurationSeconds(storyboard);
  // Сцена без измеренного тайминга (или сцен нет вовсе) не даёт права угадывать:
  // центр ролика — единственный момент, который заведомо внутри материала.
  const candidateSeconds = firstSceneSeconds === null
    ? duration / 2
    : Math.min(firstSceneSeconds, duration) / 2;
  return clampToFrameWindow(candidateSeconds, duration);
}

function firstSceneDurationSeconds(storyboard) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  if (scenes.length === 0) return null;
  const durationMs = Number(scenes[0]?.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return durationMs / 1000;
}

// Кромки ролика не годятся под обложку: первый и последний кадры у энкодеров
// часто чёрные, а seek за пределы материала вернул бы пустой кадр.
function clampToFrameWindow(seconds, duration) {
  const earliest = COVER_FRAME_EDGE_MARGIN_SECONDS;
  const latest = duration - COVER_FRAME_EDGE_MARGIN_SECONDS;
  if (latest <= earliest) return roundToMilliseconds(duration / 2);
  return roundToMilliseconds(Math.min(Math.max(seconds, earliest), latest));
}

// Момент уходит в argv с тремя знаками; округление здесь делает возвращаемое
// значение ровно тем, что получит ffmpeg, — сравнения в тестах и манифесте
// не зависят от двоичного хвоста float.
function roundToMilliseconds(seconds) {
  return Math.round(seconds * 1000) / 1000;
}
