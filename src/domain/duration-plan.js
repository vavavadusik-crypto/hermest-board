// Целевая длительность ролика: домен решает, какой padding между сценами и
// какой темп речи нужны, media-слой только исполняет решение. Здесь нет I/O —
// только чистые функции над измеренными длительностями.
//
// Темп синтеза предсказуем по НЕПРОБЕЛЬНЫМ СИМВОЛАМ, а не по словам. Замер на
// examples/ai-subscriptions-60s.ru.json (ru_RU-dmitri-medium, sentence_silence
// 0.35): 774 непробельных символа → 48.25 с чистой речи = 62.3 мс на символ,
// разброс по сценам 58.9–66.2 (±6%). «Мс на слово» на тех же данных скачет
// 306–397 (±13%) и для расчёта бюджета непригодно.

import { MIN_RECONCILED_SCENE_DURATION_MS } from "./content-pipeline.js";

export const DURATION_PLAN_LIMITS = Object.freeze({
  minTargetSeconds: 15,
  maxTargetSeconds: 3600,
  minPaddingMs: 150,
  maxPaddingMs: 1500,
  anchorPaddingMs: 400,
  minLengthScale: 0.85,
  maxLengthScale: 1.15,
  toleranceMs: 500,
  msPerNarrationCharacter: 62.3,
  charactersPerScene: 129
});

const LENGTH_SCALE_EPSILON = 0.005;

/**
 * Граница доверия: значение приходит из JSON проекта или из HTTP-тела.
 * Возвращает null, когда цель не задана (прежнее поведение конвейера).
 */
export function normalizeTargetDurationSeconds(value) {
  if (value === undefined || value === null || value === "") return null;
  const seconds = typeof value === "number" ? value : Number(String(value).trim());
  if (typeof value === "boolean" || !Number.isFinite(seconds)) {
    throw new TypeError("brief.targetDurationSeconds must be a finite number of seconds");
  }
  if (seconds < DURATION_PLAN_LIMITS.minTargetSeconds || seconds > DURATION_PLAN_LIMITS.maxTargetSeconds) {
    throw new RangeError(
      `brief.targetDurationSeconds must be between ${DURATION_PLAN_LIMITS.minTargetSeconds} and ${DURATION_PLAN_LIMITS.maxTargetSeconds} seconds`
    );
  }
  return Math.round(seconds);
}

/** Темп речи Piper: тоже внешний ввод, тоже враждебный. */
export function normalizeLengthScale(value) {
  if (value === undefined || value === null || value === "") return 1;
  const scale = typeof value === "number" ? value : Number(String(value).trim());
  if (typeof value === "boolean" || !Number.isFinite(scale)) {
    throw new TypeError("lengthScale must be a finite number");
  }
  if (scale < DURATION_PLAN_LIMITS.minLengthScale || scale > DURATION_PLAN_LIMITS.maxLengthScale) {
    throw new RangeError(
      `lengthScale must be between ${DURATION_PLAN_LIMITS.minLengthScale} and ${DURATION_PLAN_LIMITS.maxLengthScale}`
    );
  }
  return roundTo(scale, 3);
}

/** Зажим в слышимо-безопасный коридор. Небезопасный ввод по-прежнему падает. */
export function clampLengthScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) throw new TypeError("lengthScale must be a finite number");
  return roundTo(
    Math.min(DURATION_PLAN_LIMITS.maxLengthScale, Math.max(DURATION_PLAN_LIMITS.minLengthScale, scale)),
    3
  );
}

export function countNarrationCharacters(text) {
  if (typeof text !== "string") return 0;
  return text.replace(/\s+/gu, "").length;
}

export function estimateNarrationDurationMs(characters, lengthScale = 1) {
  const chars = Math.max(0, Number(characters) || 0);
  const scale = Number.isFinite(Number(lengthScale)) ? Number(lengthScale) : 1;
  return Math.round(chars * DURATION_PLAN_LIMITS.msPerNarrationCharacter * scale);
}

export function estimateNarrationCharacters(durationMs, lengthScale = 1) {
  const ms = Math.max(0, Number(durationMs) || 0);
  const scale = Number.isFinite(Number(lengthScale)) && Number(lengthScale) > 0 ? Number(lengthScale) : 1;
  return Math.round(ms / (DURATION_PLAN_LIMITS.msPerNarrationCharacter * scale));
}

/**
 * Сколько сцен нужно под выбранную длительность. Возвращает и «идеальное»
 * число, и зажатое под лимит мастера — чтобы подсказка не врала на длинных
 * роликах, где одного драфта физически не хватает.
 */
export function deriveSceneCountFromDuration(targetDurationSeconds, options = {}) {
  const minScenes = positiveInteger(options.minScenes, 2);
  const maxScenes = positiveInteger(options.maxScenes, 12);
  const charactersPerScene = positiveInteger(options.charactersPerScene, DURATION_PLAN_LIMITS.charactersPerScene);
  const target = Number(targetDurationSeconds);
  if (!Number.isFinite(target) || target <= 0) {
    return { sceneCount: minScenes, recommendedSceneCount: minScenes, capped: false };
  }
  const sceneMs = estimateNarrationDurationMs(charactersPerScene) + DURATION_PLAN_LIMITS.anchorPaddingMs;
  const recommended = Math.max(minScenes, Math.round((target * 1000) / sceneMs));
  const sceneCount = Math.min(maxScenes, recommended);
  return { sceneCount, recommendedSceneCount: recommended, capped: recommended > maxScenes };
}

/**
 * Символьный бюджет под цель: минимум (речь максимально растянута, паузы
 * максимальные), максимум (речь ускорена, паузы минимальные) и рекомендуемое
 * значение при нормальном темпе и паузе 400 мс.
 */
export function describeDurationBudget({ targetDurationSeconds, narrationCharacters = 0, sceneCount = 1 } = {}) {
  const target = Number(targetDurationSeconds);
  const scenes = Math.max(1, Math.trunc(Number(sceneCount) || 1));
  const characters = Math.max(0, Math.trunc(Number(narrationCharacters) || 0));
  if (!Number.isFinite(target) || target <= 0) {
    return {
      targetDurationSeconds: null,
      sceneCount: scenes,
      narrationCharacters: characters,
      minCharacters: 0,
      maxCharacters: 0,
      recommendedCharacters: 0,
      status: "unset"
    };
  }
  const targetMs = target * 1000;
  const minCharacters = Math.max(0, Math.ceil(
    (targetMs - scenes * DURATION_PLAN_LIMITS.maxPaddingMs)
    / (DURATION_PLAN_LIMITS.msPerNarrationCharacter * DURATION_PLAN_LIMITS.maxLengthScale)
  ));
  const maxCharacters = Math.max(0, Math.floor(
    (targetMs - scenes * DURATION_PLAN_LIMITS.minPaddingMs)
    / (DURATION_PLAN_LIMITS.msPerNarrationCharacter * DURATION_PLAN_LIMITS.minLengthScale)
  ));
  const recommendedCharacters = Math.max(0, Math.round(
    (targetMs - scenes * DURATION_PLAN_LIMITS.anchorPaddingMs) / DURATION_PLAN_LIMITS.msPerNarrationCharacter
  ));
  let status = "ok";
  if (characters < minCharacters) status = "short";
  else if (characters > maxCharacters) status = "long";
  return {
    targetDurationSeconds: target,
    sceneCount: scenes,
    narrationCharacters: characters,
    minCharacters,
    maxCharacters,
    recommendedCharacters,
    status
  };
}

/**
 * Единственное место, где принимается решение «какой padding и какой темп».
 *
 * status:
 *   on_target    — цель берётся паузами (пересинтеза нет);
 *   resynthesize — нужен новый lengthScale и один повторный синтез;
 *   out_of_range — коридоров не хватило, отдаём лучший вариант + предупреждение.
 */
export function planTargetDuration({
  targetDurationSeconds,
  measuredSceneDurationsMs,
  narrationCharacters = 0,
  lengthScale = 1,
  allowResynthesis = true
} = {}) {
  const target = normalizeTargetDurationSeconds(targetDurationSeconds);
  if (target === null) throw new TypeError("planTargetDuration requires a target duration");
  const measured = normalizeMeasuredDurations(measuredSceneDurationsMs);
  const currentScale = normalizeLengthScale(lengthScale);
  const sceneCount = measured.length;
  const narrationMs = measured.reduce((total, value) => total + value, 0);
  const targetMs = target * 1000;

  const rawPaddingMs = (targetMs - narrationMs) / sceneCount;
  const fitsWithPaddingAlone = rawPaddingMs >= DURATION_PLAN_LIMITS.minPaddingMs
    && rawPaddingMs <= DURATION_PLAN_LIMITS.maxPaddingMs;

  if (fitsWithPaddingAlone) {
    const paddingMs = Math.round(rawPaddingMs);
    return finish("on_target", { paddingMs, lengthScale: currentScale });
  }

  if (allowResynthesis) {
    const requiredSpeechMs = targetMs - sceneCount * DURATION_PLAN_LIMITS.anchorPaddingMs;
    if (requiredSpeechMs > 0) {
      const desiredScale = clampLengthScale((currentScale * requiredSpeechMs) / narrationMs);
      if (Math.abs(desiredScale - currentScale) >= LENGTH_SCALE_EPSILON) {
        return {
          status: "resynthesize",
          paddingMs: clampPaddingMs(rawPaddingMs),
          lengthScale: desiredScale,
          previousLengthScale: currentScale,
          projectedDurationMs: null,
          deviationMs: null,
          budget: describeDurationBudget({
            targetDurationSeconds: target,
            narrationCharacters,
            sceneCount
          }),
          warning: null
        };
      }
    }
  }

  const paddingMs = clampPaddingMs(rawPaddingMs);
  const projectedDurationMs = projectTotalDurationMs(measured, paddingMs);
  const deviationMs = projectedDurationMs - targetMs;
  const status = Math.abs(deviationMs) <= DURATION_PLAN_LIMITS.toleranceMs ? "on_target" : "out_of_range";
  return finish(status, { paddingMs, lengthScale: currentScale });

  function finish(resultStatus, { paddingMs: padding, lengthScale: scale }) {
    const projected = projectTotalDurationMs(measured, padding);
    const deviation = projected - targetMs;
    const budget = describeDurationBudget({
      targetDurationSeconds: target,
      narrationCharacters,
      sceneCount
    });
    return {
      status: resultStatus,
      paddingMs: padding,
      lengthScale: scale,
      previousLengthScale: currentScale,
      projectedDurationMs: projected,
      deviationMs: deviation,
      budget,
      warning: resultStatus === "out_of_range"
        ? buildDurationWarning({ target, projectedDurationMs: projected, budget })
        : null
    };
  }
}

/** Человекочитаемое предупреждение с конкретикой — и в JSON, и в интерфейс. */
export function buildDurationWarning({ target, projectedDurationMs, budget }) {
  const targetLabel = formatDurationLabel(target);
  const actualLabel = formatDurationLabel(Math.round(projectedDurationMs / 1000));
  if (budget.status === "short" || projectedDurationMs < target * 1000) {
    return `Цель ${targetLabel} недостижима: нужно примерно ${budget.recommendedCharacters} непробельных символов текста, сейчас ${budget.narrationCharacters} — добавьте карточек. Фактически получится ${actualLabel}.`;
  }
  return `Цель ${targetLabel} недостижима: текста слишком много — под неё хватит примерно ${budget.recommendedCharacters} непробельных символов, сейчас ${budget.narrationCharacters}. Сократите тексты или уберите карточки. Фактически получится ${actualLabel}.`;
}

/** Секунды → «m:ss» (или «h:mm:ss» от часа). */
export function formatDurationLabel(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * «m:ss», «h:mm:ss» или просто секунды → секунды. Возвращает null на мусоре:
 * поле ручного ввода — недоверенный источник.
 */
export function parseDurationLabel(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/u.test(text)) return null;
  const parts = text.split(":").map(part => Number.parseInt(part, 10));
  if (parts.some(part => !Number.isInteger(part))) return null;
  if (parts.length > 1 && parts.slice(1).some(part => part > 59)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) ? seconds : null;
}

function normalizeMeasuredDurations(measuredSceneDurationsMs) {
  if (!Array.isArray(measuredSceneDurationsMs) || measuredSceneDurationsMs.length === 0) {
    throw new TypeError("planTargetDuration requires at least one measured scene duration");
  }
  return measuredSceneDurationsMs.map(value => {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new TypeError("planTargetDuration requires positive measured scene durations");
    }
    return ms;
  });
}

function projectTotalDurationMs(measuredSceneDurationsMs, paddingMs) {
  return measuredSceneDurationsMs.reduce(
    (total, narrationMs) => total + Math.max(MIN_RECONCILED_SCENE_DURATION_MS, Math.ceil(narrationMs) + paddingMs),
    0
  );
}

function clampPaddingMs(value) {
  const padding = Number.isFinite(Number(value)) ? Math.round(Number(value)) : DURATION_PLAN_LIMITS.anchorPaddingMs;
  return Math.min(DURATION_PLAN_LIMITS.maxPaddingMs, Math.max(DURATION_PLAN_LIMITS.minPaddingMs, padding));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
