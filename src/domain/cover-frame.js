// Обложка снимается из середины первой сцены: это титульная сцена ролика, её
// кадр специально сделан читаемым (крупный заголовок, спокойный фон), поэтому
// он же — лучший статичный превью-кадр. Момент считается доменом, а не
// медиа-слоем: правило продуктовое, а не свойство ffmpeg.
const COVER_FRAME_EDGE_MARGIN_SECONDS = 0.05;

// Сцена собирается на глазах: элементы влетают каскадом, счётчики докручиваются.
// Самая поздняя анимация архетипов заканчивается около 2.65 с от начала сцены
// (ступенчатая задержка `calc(1.25s + i * 0.19s)` плюс 0.45 с самого движения),
// поэтому раньше этого момента кадр показывает недособранную сцену. Середина
// пятисекундной сцены — это 2.5 с, то есть ровно в разгар движения: обложку
// нужно брать не раньше, чем сцена встала.
export const SCENE_SETTLE_SECONDS = 2.8;

export function resolveCoverFrameSeconds(storyboard, { durationSeconds } = {}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("resolveCoverFrameSeconds requires a positive durationSeconds");
  }
  const firstSceneSeconds = firstSceneDurationSeconds(storyboard);
  // Сцена без измеренного тайминга (или сцен нет вовсе) не даёт права угадывать:
  // центр ролика — единственный момент, который заведомо внутри материала.
  if (firstSceneSeconds === null) return clampToFrameWindow(duration / 2, duration);

  const sceneSeconds = Math.min(firstSceneSeconds, duration);
  // Короткая сцена не успевает встать целиком — тогда берём самый поздний её
  // кадр: он всё равно собраннее середины.
  const latestInScene = Math.max(sceneSeconds - COVER_FRAME_EDGE_MARGIN_SECONDS, COVER_FRAME_EDGE_MARGIN_SECONDS);
  const settledSeconds = Math.max(sceneSeconds / 2, SCENE_SETTLE_SECONDS);
  return clampToFrameWindow(Math.min(settledSeconds, latestInScene), duration);
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
