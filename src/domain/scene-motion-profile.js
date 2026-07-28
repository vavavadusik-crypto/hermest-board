// Пользовательский профиль движения — часть документа проекта, а не состояния
// интерфейса. Этот модуль намеренно не знает ни CSS, ни DOM: его одинаково
// используют загрузчик проекта, композер сцен и запись storyboard.json.

export const SCENE_MOTION_DEPTHS = Object.freeze(["still", "flat", "depth", "space"]);
export const SCENE_MOTION_CHARACTERS = Object.freeze(["calm", "lively", "cinematic"]);
export const DEFAULT_SCENE_MOTION = Object.freeze({ depth: "depth", character: "calm" });

export function normalizeSceneMotion(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const depth = SCENE_MOTION_DEPTHS.includes(source.depth) ? source.depth : DEFAULT_SCENE_MOTION.depth;
  const character = SCENE_MOTION_CHARACTERS.includes(source.character)
    ? source.character
    : DEFAULT_SCENE_MOTION.character;
  return { depth, character };
}
