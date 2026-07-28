// Камера как отдельный слой сцены.
//
// Движение выбирается детерминированно из номера сцены и seed, но профиль
// пользователя теперь является таким же входом рендера, как формат кадра.
// Главный инвариант остаётся прежним: содержимое stage не пересекает границы
// безопасной зоны ни в одном кадре. Для 3D это проверяется проекцией четырёх
// углов плоскости, а масштаб подбирается до попадания в прямоугольник.

import {
  DEFAULT_SCENE_MOTION,
  normalizeSceneMotion
} from "../domain/scene-motion-profile.js";

export { DEFAULT_SCENE_MOTION, normalizeSceneMotion };

const CAMERA_MOVES = Object.freeze([
  { id: "push-in", from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.045, x: 0, y: -0.4 }, origin: "50% 46%" },
  { id: "drift-left", from: { scale: 1.03, x: 0.7, y: 0 }, to: { scale: 1.048, x: -0.5, y: -0.2 }, origin: "42% 50%" },
  { id: "pull-back", from: { scale: 1.055, x: 0, y: 0.3 }, to: { scale: 1.006, x: 0, y: 0 }, origin: "50% 52%" },
  { id: "drift-right", from: { scale: 1.03, x: -0.7, y: 0 }, to: { scale: 1.048, x: 0.5, y: -0.2 }, origin: "58% 50%" },
  { id: "rise", from: { scale: 1.02, x: 0, y: 0.8 }, to: { scale: 1.05, x: 0, y: -0.5 }, origin: "50% 58%" }
]);

// Дальний план движется медленнее ближнего — так работает параллакс.
const BACKDROP_FACTOR = 0.34;
const GLOW_FACTOR = 0.6;
// Фоновые слои перекрывают кадр с запасом: сдвиг фона не должен обнажать край.
const BACKGROUND_OVERSCAN = 0.06;
// Спокойный режим сохраняет прежнюю кривую и амплитуду, поэтому старые проекты
// получают буквально тот же 2.5D-ход.
const CAMERA_EASING = "cubic-bezier(0.25, 0.35, 0.4, 1)";
const CAMERA_CHARACTERS = Object.freeze({
  calm: { amplitude: 1, spaceAmplitude: 1, easing: CAMERA_EASING },
  lively: { amplitude: 1.42, spaceAmplitude: 1.3, easing: "cubic-bezier(0.18, 0.82, 0.26, 1)" },
  cinematic: { amplitude: 1.18, spaceAmplitude: 1.12, easing: "cubic-bezier(0.18, 0.04, 0.2, 1)" }
});
const SPACE_ROTATION = Object.freeze({
  "push-in": [{ rotateX: 1.4, rotateY: -1.1, z: -7 }, { rotateX: -1.2, rotateY: 1.1, z: 10 }],
  "drift-left": [{ rotateX: 0.9, rotateY: -3.1, z: 7 }, { rotateX: -0.7, rotateY: 2.4, z: -8 }],
  "pull-back": [{ rotateX: -1.3, rotateY: 1.5, z: 10 }, { rotateX: 1.1, rotateY: -1.2, z: -8 }],
  "drift-right": [{ rotateX: 0.9, rotateY: 3.1, z: 7 }, { rotateX: -0.7, rotateY: -2.4, z: -8 }],
  rise: [{ rotateX: 2.6, rotateY: -0.8, z: -6 }, { rotateX: -2.1, rotateY: 0.9, z: 9 }]
});
const MIN_CAMERA_SECONDS = 1.2;
const MAX_CAMERA_SECONDS = 600;
const DEFAULT_CAMERA_WIDTH = 1920;
const DEFAULT_CAMERA_HEIGHT = 1080;

export function selectCameraMove({ sceneIndex = 0, role = "body", seed = 1 } = {}) {
  const index = Number.isSafeInteger(sceneIndex) && sceneIndex >= 0 ? sceneIndex : 0;
  // Открывающая сцена всегда наезжает, закрывающая всегда отъезжает: это
  // грамматика, не случайность.
  if (role === "opening") return CAMERA_MOVES[0];
  if (role === "closing") return CAMERA_MOVES[2];
  const offset = Number.isSafeInteger(seed) ? Math.abs(seed) % CAMERA_MOVES.length : 0;
  return CAMERA_MOVES[(index + offset) % CAMERA_MOVES.length];
}

/**
 * Ход камеры для плоского слоя сцены: максимум масштаба приведён к единице,
 * а сдвиг ограничен оставшимся запасом. Это исходная математическая гарантия
 * safe zone, сохранённая для depth и используемая как база для space.
 */
export function stageCameraKeyframes(move, { character = DEFAULT_SCENE_MOTION.character } = {}) {
  const adjusted = applyCharacter(move, character);
  const peak = Math.max(adjusted.from.scale, adjusted.to.scale);
  return [adjusted.from, adjusted.to].map(point => {
    const scale = point.scale / peak;
    const slackPercent = ((1 - scale) / 2) * 100;
    return {
      scale,
      x: clamp(point.x, -slackPercent, slackPercent),
      y: clamp(point.y, -slackPercent, slackPercent)
    };
  });
}

/**
 * Единый план для CSS, тестов и предпросмотра. Никакой случайности здесь нет:
 * выбор человека лишь меняет детерминированный профиль того же move.
 */
export function buildCameraPlan({
  sceneIndex = 0,
  role = "body",
  durationMs = 6000,
  seed = 1,
  motion,
  width = DEFAULT_CAMERA_WIDTH,
  height = DEFAULT_CAMERA_HEIGHT
} = {}) {
  const profile = normalizeSceneMotion(motion);
  const move = selectCameraMove({ sceneIndex, role, seed });
  const duration = cameraSeconds(durationMs);
  const character = CAMERA_CHARACTERS[profile.character];
  const adjustedMove = applyCharacter(move, profile.character);
  const dimensions = normalizeDimensions(width, height);
  const enabled = profile.depth === "depth" || profile.depth === "space";

  if (!enabled) {
    return {
      motion: profile,
      move: adjustedMove,
      duration,
      easing: character.easing,
      enabled: false,
      stage: [],
      backdrop: [],
      glow: []
    };
  }

  const flatStage = stageCameraKeyframes(move, { character: profile.character });
  const stage = profile.depth === "space"
    ? spaceCameraKeyframes({ move: adjustedMove, flatStage, dimensions, spaceAmplitude: character.spaceAmplitude })
    : flatStage;
  const background = factor => [adjustedMove.from, adjustedMove.to].map(point => ({
    scale: 1 + (point.scale - 1) * factor + BACKGROUND_OVERSCAN,
    x: point.x * factor,
    y: point.y * factor
  }));

  return {
    motion: profile,
    move: adjustedMove,
    duration,
    easing: character.easing,
    enabled: true,
    stage,
    backdrop: background(BACKDROP_FACTOR),
    glow: background(GLOW_FACTOR)
  };
}

/**
 * Математическая проверка, которой пользуются тесты. Для 2D достаточно
 * прежнего slack; для space реально проецируются четыре угла плоскости.
 */
export function isStageInsideSafeZone(point, { width = DEFAULT_CAMERA_WIDTH, height = DEFAULT_CAMERA_HEIGHT } = {}) {
  const dimensions = normalizeDimensions(width, height);
  if (isSpacePoint(point)) {
    const bounds = projectSpaceBounds(point, dimensions);
    return bounds.minX >= -(dimensions.width / 2) - 1e-7
      && bounds.maxX <= (dimensions.width / 2) + 1e-7
      && bounds.minY >= -(dimensions.height / 2) - 1e-7
      && bounds.maxY <= (dimensions.height / 2) + 1e-7;
  }
  const slackPercent = ((1 - point.scale) / 2) * 100 + 1e-9;
  return point.scale <= 1 + 1e-9
    && Math.abs(point.x) <= slackPercent
    && Math.abs(point.y) <= slackPercent;
}

/** Интерполяция CSS-совместимых ключевых параметров для проверки всего хода. */
export function interpolateCameraPoint(from, to, progress) {
  const t = clamp(Number(progress) || 0, 0, 1);
  const keys = ["scale", "x", "y", "z", "rotateX", "rotateY", "perspective"];
  return keys.reduce((point, key) => {
    const start = Number(from?.[key] || 0);
    const end = Number(to?.[key] || 0);
    if (key in from || key in to) point[key] = start + (end - start) * t;
    return point;
  }, {});
}

/** Готовит CSS камеры для одной сцены. */
export function buildCameraCss(options = {}) {
  const plan = buildCameraPlan(options);
  const duration = plan.duration.toFixed(3);
  if (!plan.enabled) {
    return `\n  /* Камера и параллакс отключены: ${plan.motion.depth}. */`;
  }
  const [stageFrom, stageTo] = plan.stage;
  const [backdropFrom, backdropTo] = plan.backdrop;
  const [glowFrom, glowTo] = plan.glow;

  // База слоя — конец движения; keyframes содержит только from, поэтому
  // замороженный финальный кадр совпадает с финалом анимации.
  return `
  /* Камера сцены: ${plan.move.id}, ${duration}s, ${plan.motion.depth}/${plan.motion.character}. */
${keyframes("cam-stage", stageFrom)}
${keyframes("cam-back", backdropFrom)}
${keyframes("cam-glow", glowFrom)}
${layer(".stage", "cam-stage", plan.motion.depth === "space" ? "50% 50%" : plan.move.origin, stageTo, duration, plan.easing)}
${layer(".backdrop", "cam-back", plan.move.origin, backdropTo, duration, plan.easing)}
  .parallax-near { position: absolute; inset: 0; }
${layer(".parallax-near", "cam-glow", plan.move.origin, glowTo, duration, plan.easing)}`;
}

function applyCharacter(move, character) {
  const profile = CAMERA_CHARACTERS[normalizeSceneMotion({ character }).character];
  const scalePoint = point => ({
    scale: 1 + (point.scale - 1) * profile.amplitude,
    x: point.x * profile.amplitude,
    y: point.y * profile.amplitude
  });
  return { ...move, from: scalePoint(move.from), to: scalePoint(move.to) };
}

function spaceCameraKeyframes({ move, flatStage, dimensions, spaceAmplitude }) {
  const rotation = SPACE_ROTATION[move.id] || SPACE_ROTATION["push-in"];
  return flatStage.map((point, index) => {
    const depth = rotation[index];
    const candidate = {
      // Небольшой дополнительный запас оставляет место для перспективного
      // увеличения ближайшего края. Последний процент подбирает fit ниже.
      scale: point.scale * 0.93,
      x: point.x * 0.72,
      y: point.y * 0.72,
      z: depth.z * spaceAmplitude,
      rotateX: depth.rotateX * spaceAmplitude,
      rotateY: depth.rotateY * spaceAmplitude,
      perspective: Math.max(Math.min(dimensions.width, dimensions.height) * 5, 800)
    };
    return fitSpacePoint(candidate, dimensions);
  });
}

function fitSpacePoint(candidate, dimensions) {
  let lower = 0;
  let upper = candidate.scale;
  // При нулевом масштабе остаётся только небольшой 2D сдвиг, а значит точка
  // заведомо внутри. Бинарный поиск даёт наибольший безопасный масштаб.
  for (let index = 0; index < 40; index += 1) {
    const scale = (lower + upper) / 2;
    const point = { ...candidate, scale };
    if (isStageInsideSafeZone(point, dimensions)) lower = scale;
    else upper = scale;
  }
  return { ...candidate, scale: lower };
}

function projectSpaceBounds(point, { width, height }) {
  const radiansX = (Number(point.rotateX) || 0) * (Math.PI / 180);
  const radiansY = (Number(point.rotateY) || 0) * (Math.PI / 180);
  const cosX = Math.cos(radiansX);
  const sinX = Math.sin(radiansX);
  const cosY = Math.cos(radiansY);
  const sinY = Math.sin(radiansY);
  const scale = Number(point.scale) || 0;
  const translateX = (Number(point.x) || 0) * width / 100;
  const translateY = (Number(point.y) || 0) * height / 100;
  const translateZ = Number(point.z) || 0;
  const perspective = Math.max(Number(point.perspective) || 0, 1);
  const values = [];

  for (const localX of [-width / 2, width / 2]) {
    for (const localY of [-height / 2, height / 2]) {
      const scaledX = localX * scale;
      const scaledY = localY * scale;
      const afterYx = scaledX * cosY;
      const afterYz = -scaledX * sinY;
      const afterXy = scaledY * cosX - afterYz * sinX;
      const afterXz = scaledY * sinX + afterYz * cosX;
      const z = afterXz + translateZ;
      const projection = perspective / (perspective - z);
      values.push({ x: (afterYx + translateX) * projection, y: (afterXy + translateY) * projection });
    }
  }
  return values.reduce((bounds, value) => ({
    minX: Math.min(bounds.minX, value.x),
    maxX: Math.max(bounds.maxX, value.x),
    minY: Math.min(bounds.minY, value.y),
    maxY: Math.max(bounds.maxY, value.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function isSpacePoint(point) {
  return Object.hasOwn(point || {}, "perspective");
}

function layer(selector, name, origin, endpoint, duration, easing) {
  return `  ${selector} { transform-origin: ${origin}; transform: ${transform(endpoint)};`
    + ` animation: ${name} ${duration}s ${easing} backwards; }`;
}

function keyframes(name, endpoint) {
  return `  @keyframes ${name} { from { transform: ${transform(endpoint)}; } }`;
}

function transform({ scale, x, y, z, rotateX, rotateY, perspective }) {
  const translation = `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, ${(z || 0).toFixed(3)}px)`;
  if (Number.isFinite(perspective)) {
    return `perspective(${perspective.toFixed(3)}px) ${translation} rotateX(${(rotateX || 0).toFixed(3)}deg) rotateY(${(rotateY || 0).toFixed(3)}deg) scale(${scale.toFixed(4)})`;
  }
  return `${translation} scale(${scale.toFixed(4)})`;
}

function cameraSeconds(durationMs) {
  const seconds = Number(durationMs) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return MIN_CAMERA_SECONDS;
  return Math.min(Math.max(seconds, MIN_CAMERA_SECONDS), MAX_CAMERA_SECONDS);
}

function normalizeDimensions(width, height) {
  return {
    width: Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : DEFAULT_CAMERA_WIDTH,
    height: Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : DEFAULT_CAMERA_HEIGHT
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
