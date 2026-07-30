/**
 * Пресеты движения — данные, не ветвление.
 */

export const PRESETS = Object.freeze({
  keynote: Object.freeze({
    name: "keynote",
    character: "Сдержанно и дорого. Плавные появления, мягкая инерция.",
    enterDurationMs: { min: 500, max: 700 },
    enterEasing: "outQuint",
    enterTranslateY: { min: 20, max: 30 },
    enterTranslateX: { min: 0, max: 0 },
    staggerMs: { min: 120, max: 180 },
    cameraScaleMax: 1.045,
    cameraEasing: "cubic-bezier(0.25, 0.35, 0.4, 1)",
    backdropFactor: 0.34,
    glowFactor: 0.6,
    backgroundOverscan: 0.06,
    useBeats: "pause",
    accentSnapMs: 0,
    idleEnabled: true,
    idleDurationMs: 9000,
    idleEasing: "inOutCubic",
    blurFarLayers: false
  }),

  motion: Object.freeze({
    name: "motion",
    character: "Динамика и характер. Резкие акценты, летящие плашки.",
    enterDurationMs: { min: 220, max: 380 },
    enterEasing: "outBack",
    enterTranslateY: { min: 40, max: 80 },
    enterTranslateX: { min: -20, max: 20 },
    staggerMs: { min: 60, max: 90 },
    cameraScaleMax: 1.06,
    cameraEasing: "cubic-bezier(0.22, 0.9, 0.3, 1)",
    backdropFactor: 0.34,
    glowFactor: 0.6,
    backgroundOverscan: 0.06,
    useBeats: "accent",
    accentSnapMs: 180,
    idleEnabled: true,
    idleDurationMs: 6000,
    idleEasing: "inOutQuad",
    blurFarLayers: false
  }),

  cinematic: Object.freeze({
    name: "cinematic",
    character: "Камера и глубина. Медленный наезд, параллакс, свет.",
    enterDurationMs: { min: 800, max: 1200 },
    enterEasing: "inOutCubic",
    enterTranslateY: { min: 5, max: 15 },
    enterTranslateX: { min: 0, max: 0 },
    staggerMs: { min: 250, max: 400 },
    cameraScaleMax: 1.08,
    cameraEasing: "cubic-bezier(0.25, 0.35, 0.4, 1)",
    backdropFactor: 0.34,
    glowFactor: 0.6,
    backgroundOverscan: 0.06,
    useBeats: "none",
    accentSnapMs: 0,
    idleEnabled: true,
    idleDurationMs: 12000,
    idleEasing: "inOutCubic",
    blurFarLayers: true
  })
});

export function getPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    throw new RangeError(`Unknown preset: "${name}". Available: ${Object.keys(PRESETS).join(", ")}`);
  }
  return preset;
}
