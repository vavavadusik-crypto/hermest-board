/**
 * Ядро движка: чистая функция времени.
 * evaluateTimeline(timeline, timeMs) -> EvaluatedFrame
 * Работает в Node.js без DOM.
 *
 * Правки v3 (Ирис):
 * - validateTimeline() валидает структуру отдельно от горячего пути.
 * - Неизвестное property -> RangeError.
 * - unit !== 'px' -> RangeError (режиссёр должен перевести заранее).
 * - pingpong проходит весь диапазон за полцикла, без скачка.
 * - Ключи с одинаковым tMs на границах берут последний.
 * - __scene композицируется числами, не регулярками по строкам.
 * - Дырка между сценами -> RangeError.
 */

import { parseEasing } from "./easing.js";

// ── Константы ──
const SUPPORTED_PROPERTIES = Object.freeze([
  "opacity", "translateX", "translateY", "scale", "scaleX", "scaleY", "rotate",
  "blur", "clipReveal", "letterSpacing", "numberValue"
]);

const TRANSFORM_ORDER = Object.freeze([
  "translateX", "translateY", "rotate", "scale", "scaleX", "scaleY"
]);

const CLIP_DIRECTIONS = Object.freeze({
  left:   [0, 1, 0, 0],   // inset(0 right% 0 0)
  right:  [0, 0, 0, 1],   // inset(0 0 0 left%)
  top:    [1, 0, 0, 0],   // inset(bottom% 0 0 0)
  bottom: [0, 0, 1, 0]    // inset(0 0 top% 0)
});

// ── Утилиты ──
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mod(a, b) {
  return ((a % b) + b) % b;
}

function toSceneLocalTime(scene, timeMs) {
  return timeMs - scene.startMs;
}

// ── Валидация таймлайна ──
function validateProperty(track, layerId) {
  const prop = track.property;
  if (!SUPPORTED_PROPERTIES.includes(prop)) {
    throw new RangeError(
      `Layer "${layerId}" has unsupported property "${prop}". ` +
      `Allowed: ${SUPPORTED_PROPERTIES.join(", ")}`
    );
  }
  let prevT = -Infinity;
  for (const k of track.keys || []) {
    if (!Number.isFinite(k.tMs)) {
      throw new RangeError(
        `Layer "${layerId}" track "${prop}" key has non-finite tMs ${k.tMs}`
      );
    }
    if (k.tMs < prevT) {
      throw new RangeError(
        `Layer "${layerId}" track "${prop}" keys are not sorted: ${k.tMs} < ${prevT}`
      );
    }
    prevT = k.tMs;
    if (k.unit !== undefined && k.unit !== "px") {
      throw new RangeError(
        `Layer "${layerId}" track "${prop}" key at tMs=${k.tMs} has unit "${k.unit}". ` +
        `Only "px" is allowed in the core. Convert in the director.`
      );
    }
    if ("value" in k && !Number.isFinite(k.value)) {
      throw new RangeError(
        `Layer "${layerId}" track "${prop}" key at tMs=${k.tMs} has non-finite value ${k.value}`
      );
    }
  }
}

function validateScene(scene, index, durationMs) {
  if (!Number.isFinite(scene.startMs) || scene.startMs < 0) {
    throw new RangeError(`Scene[${index}] startMs must be finite and >= 0`);
  }
  if (!Number.isFinite(scene.durationMs) || scene.durationMs <= 0) {
    throw new RangeError(`Scene[${index}] durationMs must be finite and > 0`);
  }
  const endMs = scene.startMs + scene.durationMs;
  if (endMs > durationMs) {
    throw new RangeError(
      `Scene[${index}] ends at ${endMs}, exceeds timeline durationMs ${durationMs}`
    );
  }
  for (const layer of scene.layers || []) {
    if (!layer.id || typeof layer.id !== "string") {
      throw new RangeError(`Scene[${index}] layer must have string id`);
    }
    for (const track of layer.tracks || []) {
      validateProperty(track, layer.id);
    }
  }
}

export function validateTimeline(timeline) {
  if (!timeline || typeof timeline !== "object") {
    throw new TypeError("timeline must be an object");
  }
  if (!Number.isFinite(timeline.durationMs) || timeline.durationMs <= 0) {
    throw new RangeError("timeline.durationMs must be finite and > 0");
  }
  const scenes = timeline.scenes || [];
  let coveredMs = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    validateScene(scene, i, timeline.durationMs);
    if (scene.startMs !== coveredMs) {
      throw new RangeError(
        `Scene[${i}] starts at ${scene.startMs}, expected ${coveredMs}. ` +
        `Scenes must cover [0, durationMs) without gaps or overlaps.`
      );
    }
    coveredMs = scene.startMs + scene.durationMs;
  }
  if (coveredMs < timeline.durationMs) {
    throw new RangeError(
      `Scenes cover only [0, ${coveredMs}), but timeline.durationMs=${timeline.durationMs}`
    );
  }
  return true;
}

// ── Keyframe interval search with duplicate-time handling ──
function lastIndexAtTime(keys, tMs) {
  let idx = 0;
  while (idx + 1 < keys.length && keys[idx + 1].tMs === tMs) {
    idx++;
  }
  return idx;
}

function findKeyframeInterval(keys, t) {
  if (keys.length === 0) {
    return { leftIdx: -1, rightIdx: -1, ratio: 0 };
  }

  const firstT = keys[0].tMs;
  const lastT = keys[keys.length - 1].tMs;

  if (t <= firstT) {
    const lastDup = lastIndexAtTime(keys, firstT);
    return { leftIdx: lastDup, rightIdx: lastDup, ratio: 0 };
  }
  if (t >= lastT) {
    // Last key is by definition the last duplicate at lastT because keys are sorted.
    return { leftIdx: keys.length - 1, rightIdx: keys.length - 1, ratio: 0 };
  }

  let lo = 0, hi = keys.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid].tMs <= t) lo = mid;
    else hi = mid;
  }

  // If t lands exactly at keys[hi].tMs, prefer the last duplicate at that time.
  if (keys[hi].tMs === t) {
    const lastDup = lastIndexAtTime(keys, t);
    return { leftIdx: lastDup, rightIdx: lastDup, ratio: 0 };
  }

  const left = keys[lo];
  const right = keys[hi];
  const span = right.tMs - left.tMs;
  const ratio = span === 0 ? 0 : (t - left.tMs) / span;

  return { leftIdx: lo, rightIdx: hi, ratio: clamp(ratio, 0, 1) };
}

function interpolateValue(keys, leftIdx, rightIdx, ratio) {
  const left = keys[leftIdx];
  const right = keys[rightIdx];

  if (leftIdx === rightIdx) {
    return left.value;
  }

  const easingFn = parseEasing(right.easing || "linear");
  const easedRatio = easingFn(ratio);
  return lerp(left.value, right.value, easedRatio);
}

// ── Repeat / loop / pingpong ──
function applyRepeat(track, localMs) {
  const repeat = track.repeat || "none";
  if (repeat === "none") {
    return { t: localMs, cycleLen: null };
  }

  const keys = track.keys;
  if (keys.length < 2) {
    return { t: localMs, cycleLen: null };
  }

  const firstT = keys[0].tMs;
  const lastT = keys[keys.length - 1].tMs;
  const cycleLen = lastT - firstT;
  if (cycleLen <= 0) {
    return { t: localMs, cycleLen: null };
  }

  const phaseMs = track.phaseMs || 0;
  let offset = mod(localMs - firstT - phaseMs, cycleLen);
  let t = firstT + offset;

  if (repeat === "pingpong") {
    const half = cycleLen / 2;
    const forward = offset < half;
    const phase = forward
      ? offset / half
      : (offset - half) / half;         // 0..1 inside half-cycle
    t = forward
      ? firstT + phase * cycleLen       // go all the way from firstT to lastT
      : lastT - phase * cycleLen;       // and back
    // Clamp rounding errors
    t = clamp(t, firstT, lastT);
  }

  return { t, cycleLen };
}

function evaluateTrack(track, localMs) {
  const { t } = applyRepeat(track, localMs);
  const keys = track.keys;

  if (keys.length === 0) {
    return null;
  }

  const { leftIdx, rightIdx, ratio } = findKeyframeInterval(keys, t);

  if (leftIdx === -1) {
    return null;
  }

  return interpolateValue(keys, leftIdx, rightIdx, ratio);
}

// ── Style builders ──
function buildTransform(values) {
  const tx = values.translateX ?? 0;
  const ty = values.translateY ?? 0;
  const rot = values.rotate ?? 0;
  const sx = (values.scale ?? 1) * (values.scaleX ?? 1);
  const sy = (values.scale ?? 1) * (values.scaleY ?? 1);
  return `translate3d(${tx.toFixed(4)}px, ${ty.toFixed(4)}px, 0) rotate(${rot.toFixed(4)}deg) scale(${sx.toFixed(6)}, ${sy.toFixed(6)})`;
}

function buildFilter(values) {
  const parts = [];
  if (values.blur !== undefined && values.blur !== 0) {
    parts.push(`blur(${values.blur.toFixed(4)}px)`);
  }
  return parts.length === 0 ? "none" : parts.join(" ");
}

function buildClipPath(values) {
  if (values.clipReveal === undefined) return "none";
  const v = clamp(values.clipReveal, 0, 1);
  const hidden = 1 - v;
  const dir = CLIP_DIRECTIONS[values.from || "left"] || CLIP_DIRECTIONS.left;
  const top    = (dir[0] * hidden * 100).toFixed(4);
  const right  = (dir[1] * hidden * 100).toFixed(4);
  const bottom = (dir[2] * hidden * 100).toFixed(4);
  const left   = (dir[3] * hidden * 100).toFixed(4);
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

function findActiveScene(scenes, timeMs) {
  for (let i = scenes.length - 1; i >= 0; i--) {
    const scene = scenes[i];
    const endMs = scene.startMs + scene.durationMs;
    if (timeMs >= scene.startMs && timeMs < endMs) {
      return { scene, index: i };
    }
  }
  if (scenes.length > 0) {
    const last = scenes[scenes.length - 1];
    const lastEnd = last.startMs + last.durationMs;
    if (timeMs >= last.startMs && timeMs <= lastEnd) {
      return { scene: last, index: scenes.length - 1 };
    }
  }
  return { scene: null, index: -1 };
}

// ── Numeric composition of __scene ──
function applySceneLayer(layerMap, sceneValues) {
  const sceneOpacity = sceneValues.opacity ?? 1;
  const sceneTx = sceneValues.translateX ?? 0;
  const sceneTy = sceneValues.translateY ?? 0;
  const sceneRot = sceneValues.rotate ?? 0;
  const sceneScale = sceneValues.scale ?? 1;

  for (const layerId of Object.keys(layerMap)) {
    const layer = layerMap[layerId];

    // opacity
    if (layer.opacity !== undefined) {
      layer.opacity = (parseFloat(layer.opacity) * sceneOpacity).toFixed(6);
    } else if (sceneOpacity !== 1) {
      layer.opacity = sceneOpacity.toFixed(6);
    }

    // transform numeric composition
    if (layer.transform || sceneTx !== 0 || sceneTy !== 0 || sceneRot !== 0 || sceneScale !== 1) {
      let tx = 0, ty = 0, rot = 0, sx = 1, sy = 1;
      const m = layer.transform && layer.transform.match(
        /translate3d\(([^,]+)px,\s*([^,]+)px,\s*0\)\s*rotate\(([^)]+)deg\)\s*scale\(([^)]+)\)/
      );
      if (m) {
        tx = parseFloat(m[1]);
        ty = parseFloat(m[2]);
        rot = parseFloat(m[3]);
        const scaleArgs = m[4].split(",").map(s => parseFloat(s.trim()));
        sx = scaleArgs[0] ?? 1;
        sy = scaleArgs[1] ?? scaleArgs[0] ?? 1;
      }
      tx += sceneTx;
      ty += sceneTy;
      rot += sceneRot;
      const layerSx = sx;
      const layerSy = sy;
      sx = layerSx * sceneScale;
      sy = layerSy * sceneScale;
      layer.transform = `translate3d(${tx.toFixed(4)}px, ${ty.toFixed(4)}px, 0) rotate(${rot.toFixed(4)}deg) scale(${sx.toFixed(6)}, ${sy.toFixed(6)})`;
    }
  }
}

// ── Public evaluateTimeline ──
export function evaluateTimeline(timeline, timeMs) {
  if (!timeline || typeof timeline !== "object") {
    throw new TypeError("timeline must be an object");
  }
  if (!Number.isFinite(timeMs)) {
    throw new TypeError("timeMs must be a finite number");
  }

  validateTimeline(timeline);

  const durationMs = timeline.durationMs;
  const clampedTime = clamp(timeMs, 0, durationMs);

  const { scene } = findActiveScene(timeline.scenes || [], clampedTime);

  if (!scene) {
    // Should not happen because validateTimeline guarantees coverage.
    return { timeMs: clampedTime, sceneId: null, layers: {}, values: {} };
  }

  const localMs = toSceneLocalTime(scene, clampedTime);
  const layerMap = {};
  const frameValues = {};

  for (const layer of scene.layers || []) {
    const layerId = layer.id;
    const values = {};

    for (const track of layer.tracks || []) {
      const prop = track.property;
      if (!SUPPORTED_PROPERTIES.includes(prop)) {
        throw new RangeError(
          `Layer "${layerId}" has unsupported property "${prop}". ` +
          `Allowed: ${SUPPORTED_PROPERTIES.join(", ")}`
        );
      }

      const val = evaluateTrack(track, localMs);
      if (val !== null) {
        values[prop] = val;
      }
    }

    const styles = {};

    if (values.opacity !== undefined) {
      styles.opacity = clamp(values.opacity, 0, 1).toFixed(6);
    }

    const hasTransform = TRANSFORM_ORDER.some(p => values[p] !== undefined);
    if (hasTransform) {
      styles.transform = buildTransform(values);
    }

    if (values.blur !== undefined) {
      styles.filter = buildFilter(values);
    }

    if (values.clipReveal !== undefined) {
      styles.clipPath = buildClipPath(values, layerId);
    }

    if (values.letterSpacing !== undefined) {
      styles.letterSpacing = `${values.letterSpacing.toFixed(4)}px`;
    }

    layerMap[layerId] = styles;

    if (values.numberValue !== undefined) {
      frameValues[layerId] = values.numberValue;
    }
  }

  // Apply synthetic __scene layer numerically; then remove it from output.
  const sceneLayer = layerMap["__scene"];
  if (sceneLayer) {
    const sceneValues = {};
    if (sceneLayer.opacity !== undefined) sceneValues.opacity = parseFloat(sceneLayer.opacity);
    if (sceneLayer.transform) {
      const m = sceneLayer.transform.match(
        /translate3d\(([^,]+)px,\s*([^,]+)px,\s*0\)\s*rotate\(([^)]+)deg\)\s*scale\(([^)]+)\)/
      );
      if (m) {
        sceneValues.translateX = parseFloat(m[1]);
        sceneValues.translateY = parseFloat(m[2]);
        sceneValues.rotate = parseFloat(m[3]);
        const scaleArgs = m[4].split(",").map(s => parseFloat(s.trim()));
        sceneValues.scale = scaleArgs[0] ?? 1;
      }
    }
    applySceneLayer(layerMap, sceneValues);
    delete layerMap["__scene"];
  }

  return {
    timeMs: clampedTime,
    sceneId: scene.id,
    layers: layerMap,
    values: frameValues
  };
}

export { SUPPORTED_PROPERTIES, TRANSFORM_ORDER, clamp, lerp };
