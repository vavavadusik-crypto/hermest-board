/**
 * Easing functions for Hermest Animation Engine.
 * All functions are deterministic and pure.
 *
 * Правка v3 (Ирис): именованные кривые НЕ подменяются "похожими" cubic-bezier.
 * Только строки, буквально начинающиеся с cubic-bezier(, считаются точными.
 * Всё остальное — сэмплируется в 51 стоп (шаг 2 %) при компиляции в CSS.
 */

const EASING_NAMES = Object.freeze([
  "linear",
  "inQuad", "outQuad", "inOutQuad",
  "inCubic", "outCubic", "inOutCubic",
  "inQuart", "outQuart", "inOutQuart",
  "inQuint", "outQuint", "inOutQuint",
  "outBack", "outElastic"
]);

// ── Named easing implementations ──
function linear(t) { return t; }
function inQuad(t) { return t * t; }
function outQuad(t) { return 1 - (1 - t) * (1 - t); }
function inOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function inCubic(t) { return t * t * t; }
function outCubic(t) { return 1 - Math.pow(1 - t, 3); }
function inOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function inQuart(t) { return t * t * t * t; }
function outQuart(t) { return 1 - Math.pow(1 - t, 4); }
function inOutQuart(t) { return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; }
function inQuint(t) { return t * t * t * t * t; }
function outQuint(t) { return 1 - Math.pow(1 - t, 5); }
function inOutQuint(t) { return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2; }

function outBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function outElastic(t) {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

const NAMED_EASINGS = Object.freeze({
  linear, inQuad, outQuad, inOutQuad,
  inCubic, outCubic, inOutCubic,
  inQuart, outQuart, inOutQuart,
  inQuint, outQuint, inOutQuint,
  outBack, outElastic
});

// ── Cubic Bezier with fixed Newton iterations ──

function cubicBezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  return u2 * u * p0 + 3 * u2 * t * p1 + 3 * u * t2 * p2 + t2 * t * p3;
}

function cubicBezierDerivative(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

function solveCubicBezierX(x, x1, x2) {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xAtT = cubicBezierPoint(t, 0, x1, x2, 1);
    const dxAtT = cubicBezierDerivative(t, 0, x1, x2, 1);
    if (Math.abs(dxAtT) < 1e-6) break;
    t = t - (xAtT - x) / dxAtT;
    t = Math.max(0, Math.min(1, t));
  }
  return t;
}

export function parseEasing(easingStr) {
  if (typeof easingStr !== "string") {
    throw new TypeError("easing must be a string");
  }

  const trimmed = easingStr.trim();

  if (NAMED_EASINGS[trimmed]) {
    return NAMED_EASINGS[trimmed];
  }

  const cbMatch = trimmed.match(/^cubic-bezier\s*\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)$/);
  if (cbMatch) {
    const x1 = parseFloat(cbMatch[1]);
    const y1 = parseFloat(cbMatch[2]);
    const x2 = parseFloat(cbMatch[3]);
    const y2 = parseFloat(cbMatch[4]);

    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      throw new RangeError("cubic-bezier parameters must be finite numbers");
    }
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
      throw new RangeError(`cubic-bezier x coordinates must be in [0,1], got x1=${x1}, x2=${x2}`);
    }

    return function cubicBezierEasing(t) {
      const solvedT = solveCubicBezierX(t, x1, x2);
      return cubicBezierPoint(solvedT, 0, y1, y2, 1);
    };
  }

  throw new RangeError(`Unknown easing: "${trimmed}". Expected one of: ${EASING_NAMES.join(", ")} or cubic-bezier(a,b,c,d)`);
}

/**
 * Возвращает true только для точных CSS cubic-bezier строк.
 * Именованные кривые теперь НЕ считаются точно представимыми,
 * потому что easingToCss дал бы ложный двойник.
 */
export function isCssCubicBezier(easingStr) {
  if (easingStr === "linear") return true;
  const cbMatch = easingStr.match(/^cubic-bezier\s*\(/);
  return !!cbMatch;
}

/**
 * Сэмплировать произвольный easing.
 * По умолчанию 51 стоп (шаг 2%), но для кривых с высокой кривизной
 * (outElastic и др.) адаптивно удваиваем плотность до maxSteps,
 * чтобы линейная интерполяция CSS отклонялась не более чем на 0.25%.
 */
export function sampleEasing(easingStr, steps = 51, maxSteps = 513) {
  const fn = parseEasing(easingStr);

  function buildUniform(n) {
    const samples = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      samples.push({ t, value: fn(t) });
    }
    return samples;
  }

  function refine(samples) {
    const refined = [samples[0]];
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const midT = (a.t + b.t) / 2;
      const exactMid = fn(midT);
      const linearMid = (a.value + b.value) / 2;
      const err = Math.abs(exactMid - linearMid);
      if (err > 0.0002 && samples.length * 2 - 1 <= maxSteps) {
        refined.push({ t: midT, value: exactMid });
      }
      refined.push(b);
    }
    return refined;
  }

  let samples = buildUniform(steps);
  while (samples.length < maxSteps) {
    const next = refine(samples);
    if (next.length === samples.length) break;
    samples = next;
  }
  return samples;
}

export { EASING_NAMES, NAMED_EASINGS };
