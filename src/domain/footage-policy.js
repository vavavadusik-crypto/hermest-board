// Правило «когда рендеру позволено выходить в сеть» — продуктовое, а не деталь
// медиа-слоя: обещание «по умолчанию офлайн и детерминированно» стоит в
// README и в docs/RENDER_PIPELINE.md, поэтому решение живёт в домене и
// проверяется тестами отдельно от самого рендера.

const DETERMINISTIC_MODE = "deterministic";

/**
 * Внешние источники (сток, генераторы картинок) включаются только по явному
 * намерению: тумблер проекта, настроенный ключ провайдера или env-override
 * оператора. Режим `auto`, лежащий в проекте по умолчанию, сам по себе
 * разрешением не является — иначе первый же рендер чистой доски молча уходит
 * в сеть.
 */
export function resolveFootageMode({
  brollMode = "auto",
  hasModeOverride = false,
  generateVisuals = false,
  hasKeyedProvider = false
} = {}) {
  const requestedMode = typeof brollMode === "string" && brollMode ? brollMode : "auto";
  const wantsExternalFootage = hasModeOverride === true
    || generateVisuals === true
    || hasKeyedProvider === true;

  if (wantsExternalFootage) {
    return { mode: requestedMode, wantsExternalFootage: true, warning: null };
  }

  return {
    mode: DETERMINISTIC_MODE,
    wantsExternalFootage: false,
    // Молчаливое расхождение хуже отказа: выбранный в проекте режим и
    // фактическое поведение обязаны расходиться вслух, в манифесте.
    warning: requestedMode === DETERMINISTIC_MODE
      ? null
      : `external footage skipped: brollMode "${requestedMode}" needs brief.generateVisuals or a configured provider key`
  };
}
