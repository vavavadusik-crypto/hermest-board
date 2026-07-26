// Свободный выбор длительности для верхней командной строки: не пресеты, а
// непрерывная шкала 15 с … 60 мин. Шаг нелинейный — на коротких роликах секунда
// решает («минута и три секунды»), на часовых лекциях полминуты не заметна.
//
// Шкала построена явной лестницей значений, а не логарифмом: индекс остановки
// и есть позиция ползунка, поэтому «ползунок → секунды → ползунок» сходится
// точно, стрелки клавиатуры дают ровно одно осмысленное значение за нажатие,
// а поле ручного ввода и ползунок никогда не расходятся на доли секунды.

import { DURATION_PLAN_LIMITS, formatDurationLabel, parseDurationLabel } from "../domain/duration-plan.js";

// Секундный шаг держится до пяти минут: владелец просил уметь «минуту и три
// секунды», а на коротком ролике 63 ≠ 65 — это заметно на слух. Дальше шаг
// растёт, потому что на получасовой лекции секунда не различима, а лишние
// остановки только замедляют перетаскивание.
const STEP_LADDER = Object.freeze([
  { untilSeconds: 300, stepSeconds: 1 },
  { untilSeconds: 900, stepSeconds: 5 },
  { untilSeconds: 1800, stepSeconds: 15 },
  { untilSeconds: DURATION_PLAN_LIMITS.maxTargetSeconds, stepSeconds: 30 }
]);

export const DURATION_SLIDER_STOPS = Object.freeze(buildStops());
export const DURATION_SLIDER_MAX_POSITION = DURATION_SLIDER_STOPS.length - 1;
export const DEFAULT_TARGET_DURATION_SECONDS = 60;

/**
 * Быстрые метки — дополнение к свободному выбору, а не замена: каждая обязана
 * попадать в шкалу, иначе клик по метке сдвинул бы ползунок мимо подписи.
 */
export const DURATION_QUICK_MARKS = Object.freeze([30, 60, 180, 600, 1800, 3600]);

/** Позиция ползунка → секунды. Любой мусор даёт дефолтную минуту, а не NaN. */
export function sliderPositionToSeconds(position) {
  const index = toFiniteNumber(position);
  if (index === null) return DEFAULT_TARGET_DURATION_SECONDS;
  const clamped = Math.min(DURATION_SLIDER_MAX_POSITION, Math.max(0, Math.round(index)));
  return DURATION_SLIDER_STOPS[clamped];
}

/** Секунды → ближайшая остановка ползунка. */
export function secondsToSliderPosition(seconds) {
  const target = snapDurationSeconds(seconds);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < DURATION_SLIDER_STOPS.length; index += 1) {
    const distance = Math.abs(DURATION_SLIDER_STOPS[index] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Ручной ввод m:ss → ближайшее допустимое значение шкалы. */
export function snapDurationSeconds(seconds) {
  const value = toFiniteNumber(seconds);
  if (value === null) return DEFAULT_TARGET_DURATION_SECONDS;
  // Зажимаем дробное значение как есть: округление до сравнения сдвинуло бы
  // ровную середину между остановками в сторону большей.
  const bounded = Math.min(
    DURATION_PLAN_LIMITS.maxTargetSeconds,
    Math.max(DURATION_PLAN_LIMITS.minTargetSeconds, value)
  );
  let best = DURATION_SLIDER_STOPS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stop of DURATION_SLIDER_STOPS) {
    const distance = Math.abs(stop - bounded);
    // При равном расстоянии выигрывает меньшее значение: пользователь просил
    // «не длиннее», а не «примерно столько же».
    if (distance < bestDistance) {
      bestDistance = distance;
      best = stop;
    }
  }
  return best;
}

/**
 * Поле ручного ввода — недоверенный источник, поэтому решение «что показать
 * после ввода» принимается здесь, а не в обработчике события.
 *
 * accepted=false означает «оставь прежнее значение и скажи об этом»: молча
 * подменять «абырвалг» минутой нечестно, а сбрасывать в дефолт — обидно.
 * clamped=true — ввод был вне диапазона или между остановками шкалы, и
 * значение подтянуто к ближайшему допустимому.
 */
export function resolveTypedDuration(rawValue, currentSeconds = DEFAULT_TARGET_DURATION_SECONDS) {
  const fallback = snapDurationSeconds(currentSeconds);
  const parsed = parseDurationLabel(typeof rawValue === "string" ? rawValue.trim() : rawValue);
  if (parsed === null) {
    return { seconds: fallback, accepted: false, clamped: false, label: formatDurationLabel(fallback) };
  }
  const seconds = snapDurationSeconds(parsed);
  return {
    seconds,
    accepted: true,
    clamped: seconds !== parsed,
    label: formatDurationLabel(seconds)
  };
}

/**
 * Честная подсказка под ползунком: сколько текста требует выбранная
 * длительность и сколько его есть сейчас. Возвращает и статус, чтобы UI мог
 * подсветить нехватку, и готовый текст — его вставляют через textContent.
 */
export function describeDurationHint({ budget, sceneCount, hasBoard = true } = {}) {
  if (!budget || budget.status === "unset") {
    return { status: "unset", text: "Выбери длительность — система сама рассчитает число сцен и объём текста." };
  }
  const label = formatDurationLabel(budget.targetDurationSeconds);
  const scenes = Math.max(1, Math.trunc(Number(sceneCount) || budget.sceneCount || 1));
  const plan = `${label} — примерно ${scenes} ${pluralizeScenes(scenes)}, около ${budget.recommendedCharacters} символов закадрового текста.`;
  if (!hasBoard || budget.narrationCharacters === 0) {
    return { status: "planned", text: `${plan} Текст напишет ИИ-модель под этот объём.` };
  }
  const have = `Сейчас на доске ${budget.narrationCharacters}.`;
  if (budget.status === "short") {
    return {
      status: "short",
      text: `${plan} ${have} Текста не хватает — под ${label} нужно минимум ${budget.minCharacters}: добавь карточек или выбери длительность короче.`
    };
  }
  if (budget.status === "long") {
    return {
      status: "long",
      text: `${plan} ${have} Текста слишком много — под ${label} влезает максимум ${budget.maxCharacters}: сократи тексты или выбери длительность длиннее.`
    };
  }
  return { status: "ok", text: `${plan} ${have} Объём подходит.` };
}

/**
 * Number("") и Number("   ") дают 0, а не NaN — для поля ввода это ловушка:
 * пустая строка означает «значения нет», а не «ноль секунд».
 */
function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pluralizeScenes(count) {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "сцен";
  switch (count % 10) {
    case 1: return "сцена";
    case 2:
    case 3:
    case 4: return "сцены";
    default: return "сцен";
  }
}

function buildStops() {
  const stops = [];
  let seconds = DURATION_PLAN_LIMITS.minTargetSeconds;
  for (const { untilSeconds, stepSeconds } of STEP_LADDER) {
    while (seconds <= untilSeconds) {
      stops.push(seconds);
      seconds += stepSeconds;
    }
    // Следующая ступень стартует с первого значения своего шага после границы.
    seconds = untilSeconds + nextStepAfter(untilSeconds);
  }
  if (stops[stops.length - 1] !== DURATION_PLAN_LIMITS.maxTargetSeconds) {
    stops.push(DURATION_PLAN_LIMITS.maxTargetSeconds);
  }
  return stops;
}

function nextStepAfter(boundarySeconds) {
  const rung = STEP_LADDER.find(entry => entry.untilSeconds > boundarySeconds);
  return rung ? rung.stepSeconds : STEP_LADDER[STEP_LADDER.length - 1].stepSeconds;
}
