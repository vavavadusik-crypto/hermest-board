/**
 * Компиляция таймлайна в CSS @keyframes + animation.
 *
 * Правка v7 (Ирис):
 * - Для группы CSS-свойства с одним треком: дешёвый посегментный сэмплер,
 *   как в v4, со своим периодом, задержкой и repeat.
 * - Для группы с несколькими треками: рекурсивное криволинейное сэмплирование
 *   выхода ядра, стопы ставятся только там, где кривая гнётся.
 * - Допуск 0.5 % от диапазона свойства.
 * - Одно объявление animation: на слой.
 */

import { evaluateTimeline } from "./timeline.js";
import { isCssCubicBezier, sampleEasing } from "./easing.js";

const SUPPORTED_CSS_PROPS = new Set([
  "opacity", "translateX", "translateY", "rotate", "scale", "scaleX", "scaleY",
  "blur", "letterSpacing"
]);

const PROP_CSS_NAME = {
  opacity: "opacity",
  translateX: "transform",
  translateY: "transform",
  rotate: "transform",
  scale: "transform",
  scaleX: "transform",
  scaleY: "transform",
  blur: "filter",
  letterSpacing: "letter-spacing"
};

// Ranges for relative error calculation.
const PROP_RANGE = {
  opacity: 1,
  blur: 20,
  letterSpacing: 20,
  translateX: 1920,
  translateY: 1080,
  rotate: 90,
  scale: 1
};

function mod(a, b) {
  return ((a % b) + b) % b;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function buildTransformRule(values) {
  const parts = [];
  if (values.translateX !== undefined || values.translateY !== undefined) {
    const tx = values.translateX ?? 0;
    const ty = values.translateY ?? 0;
    parts.push(`translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`);
  }
  if (values.rotate !== undefined) parts.push(`rotate(${values.rotate.toFixed(2)}deg)`);
  const sx = (values.scale ?? 1) * (values.scaleX ?? 1);
  const sy = (values.scale ?? 1) * (values.scaleY ?? 1);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`);
  return parts.length ? parts.join(" ") : "none";
}

// ── Cheap path: single track per CSS property ───────────────────────────────

function sampleTrackForCss(track) {
  const repeat = track.repeat || "none";
  const keys = track.keys;
  const firstT = keys[0].tMs;
  const lastT = keys[keys.length - 1].tMs;
  const cycleLenMs = Math.max(1, lastT - firstT);
  const cssPeriodMs = repeat === "pingpong" ? cycleLenMs / 2 : cycleLenMs;

  const stops = [];

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const segStart = a.tMs;
    const segEnd = b.tMs;
    const segLen = Math.max(1, segEnd - segStart);
    const easingStr = b.easing || "linear";

    let segStops;
    if (isCssCubicBezier(easingStr)) {
      segStops = [{ t: 0, value: a.value }, { t: 1, value: b.value }];
    } else {
      const base = sampleEasing(easingStr, 51, 513);
      const minT = base[0].t;
      const maxT = base[base.length - 1].t;
      const scale = maxT === minT ? 1 : 1 / (maxT - minT);
      segStops = base.map(s => ({
        t: (s.t - minT) * scale,
        value: a.value + (b.value - a.value) * s.value
      }));
    }

    for (const s of segStops) {
      const tMs = segStart + s.t * segLen;
      const pct = repeat === "pingpong"
        ? ((tMs - firstT) / cycleLenMs) * 100
        : ((tMs - firstT) / cssPeriodMs) * 100;
      stops.push({ pct, values: { [track.property]: s.value } });
    }
  }

  // Deduplicate by pct.
  const map = new Map();
  for (const s of stops) {
    map.set(s.pct.toFixed(4), s);
  }
  return Array.from(map.values()).sort((a, b) => a.pct - b.pct);
}

function buildSingleTrackAnimation(track, sceneId, layerId, cssProp, index) {
  const repeat = track.repeat || "none";
  const firstT = track.keys[0].tMs;
  const lastT = track.keys[track.keys.length - 1].tMs;
  const cycleLenMs = Math.max(1, lastT - firstT);
  const phase = mod(track.phaseMs || 0, cycleLenMs);

  let durationSec, delaySec, iteration, direction, easing;
  if (repeat === "none") {
    durationSec = (cycleLenMs / 1000).toFixed(3);
    delaySec = (firstT / 1000).toFixed(3);
    iteration = "1";
    direction = "normal";
    easing = "linear";
  } else if (repeat === "loop") {
    durationSec = (cycleLenMs / 1000).toFixed(3);
    delaySec = ((firstT + phase - cycleLenMs) / 1000).toFixed(3);
    iteration = "infinite";
    direction = "normal";
    easing = "linear";
  } else if (repeat === "pingpong") {
    durationSec = (cycleLenMs / 2000).toFixed(3);
    delaySec = ((firstT + phase - cycleLenMs) / 1000).toFixed(3);
    iteration = "infinite";
    direction = "alternate";
    easing = "ease-in-out";
  } else {
    durationSec = (cycleLenMs / 1000).toFixed(3);
    delaySec = (firstT / 1000).toFixed(3);
    iteration = "1";
    direction = "normal";
    easing = "linear";
  }

  const stops = sampleTrackForCss(track);
  if (stops.length === 0) return null;

  const name = `kf-${sceneId}-${layerId}-${cssProp}-${index}`;
  const body = buildKeyframesBody(stops, cssProp);
  const keyframeBlock = `@keyframes ${name} {\n    ${body}\n  }`;
  const animDecl = `${durationSec}s ${easing} ${delaySec}s ${iteration} ${direction} both ${name}`;
  return { keyframeBlock, animDecl };
}

// ── Core-sampling path: multiple tracks per CSS property ────────────────────

function evaluateLayerValues(timeline, scene, layer, tMs) {
  const frame = evaluateTimeline(timeline, tMs);
  const styles = frame.layers[layer.id];
  if (!styles) return {};

  const values = {};
  if (styles.opacity !== undefined) values.opacity = parseFloat(styles.opacity);

  const tf = styles.transform;
  if (tf && tf !== "none") {
    const txm = tf.match(/translate3d\(([^,]+)px,\s*([^,]+)px/);
    if (txm) {
      values.translateX = parseFloat(txm[1]);
      values.translateY = parseFloat(txm[2]);
    }
    const rotm = tf.match(/rotate\(([^)]+)deg\)/);
    if (rotm) values.rotate = parseFloat(rotm[1]);
    const scm = tf.match(/scale\(([^)]+)\)/);
    if (scm) {
      const scaleArgs = scm[1].split(",").map(s => parseFloat(s.trim()));
      values.scaleX = scaleArgs[0] ?? 1;
      values.scaleY = scaleArgs[1] ?? scaleArgs[0] ?? 1;
    }
  }

  const blurM = styles.filter && styles.filter.match(/blur\(([^p]+)px\)/);
  if (blurM) values.blur = parseFloat(blurM[1]);

  if (styles.letterSpacing !== undefined) values.letterSpacing = parseFloat(styles.letterSpacing);

  return values;
}

function lerpLayerValues(a, b, r) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    out[k] = av + (bv - av) * r;
  }
  return out;
}

function layerValueError(actual, lerp, cssProp, range) {
  if (cssProp === "transform") {
    const comps = [
      ["translateX", PROP_RANGE.translateX],
      ["translateY", PROP_RANGE.translateY],
      ["rotate", PROP_RANGE.rotate],
      ["scale", PROP_RANGE.scale],
      ["scaleX", PROP_RANGE.scale],
      ["scaleY", PROP_RANGE.scale]
    ];
    let maxErr = 0;
    for (const [prop, propRange] of comps) {
      const av = actual[prop] ?? 0;
      const lv = lerp[prop] ?? 0;
      const denom = Math.max(Math.abs(av), Math.abs(lv), propRange * 0.1);
      const err = Math.abs(av - lv) / denom * 100;
      if (err > maxErr) maxErr = err;
    }
    return maxErr;
  }
  const propMap = { "opacity": "opacity", "filter": "blur", "letter-spacing": "letterSpacing" };
  const key = propMap[cssProp];
  const av = key ? (actual[key] ?? 0) : 0;
  const lv = key ? (lerp[key] ?? 0) : 0;
  const denom = Math.max(Math.abs(av), Math.abs(lv), range * 0.1);
  return Math.abs(av - lv) / denom * 100;
}

function recursiveSampleLayer(timeline, scene, layer, cssProp) {
  // Build initial critical stops at scene boundaries and all track key times.
  const criticalTimes = new Set([scene.startMs, scene.startMs + scene.durationMs]);
  for (const track of layer.tracks || []) {
    if (!Array.isArray(track.keys)) continue;
    for (const k of track.keys) {
      const t = scene.startMs + k.tMs;
      if (t >= scene.startMs && t <= scene.startMs + scene.durationMs) {
        criticalTimes.add(t);
      }
    }
  }

  const times = Array.from(criticalTimes).sort((a, b) => a - b);
  let stops = times.map(t => ({
    pct: ((t - scene.startMs) / scene.durationMs) * 100,
    values: evaluateLayerValues(timeline, scene, layer, t)
  }));

  const range = PROP_RANGE[cssProp] ?? 100;
  const tolerance = 0.5; // percent of range

  // Recursive adaptive subdivision, same strategy as sampleEasing.
  function refine(a, b) {
    let bestErr = 0;
    let bestT = null;
    let bestValues = null;
    let bestFrac = 0.5;
    for (const frac of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const t = a.pct / 100 * scene.durationMs * (1 - frac) + b.pct / 100 * scene.durationMs * frac + scene.startMs;
      const midValues = evaluateLayerValues(timeline, scene, layer, t);
      const lerpValues = lerpLayerValues(a.values, b.values, frac);
      const err = layerValueError(midValues, lerpValues, cssProp, range);
      if (err > bestErr) {
        bestErr = err;
        bestT = t;
        bestValues = midValues;
        bestFrac = frac;
      }
    }

    if (bestErr <= tolerance) return;
    const midStop = { pct: ((bestT - scene.startMs) / scene.durationMs) * 100, values: bestValues };
    refine(a, midStop);
    stops.push(midStop);
    refine(midStop, b);
  }

  for (let i = 0; i < times.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    refine(a, b);
  }

  return stops.sort((a, b) => a.pct - b.pct);
}

function buildCoreSampledAnimation(timeline, scene, layer, cssProp, sceneId, index) {
  const stops = recursiveSampleLayer(timeline, scene, layer, cssProp);
  if (stops.length === 0) return null;

  const name = `kf-${sceneId}-${layer.id}-${cssProp}-${index}`;
  const body = buildKeyframesBody(stops, cssProp);
  const durationSec = (scene.durationMs / 1000).toFixed(3);
  return {
    keyframeBlock: `@keyframes ${name} {\n    ${body}\n  }`,
    animDecl: `${durationSec}s linear 0s 1 normal both ${name}`
  };
}

// ── Common helpers ─────────────────────────────────────────────────────────

function buildKeyframesBody(stops, cssProp) {
  return stops
    .map(s => {
      const decls = [];
      if (cssProp === "opacity") {
        decls.push(`opacity: ${clamp(s.values.opacity, 0, 1).toFixed(6)}`);
      } else if (cssProp === "transform") {
        decls.push(`transform: ${buildTransformRule(s.values)}`);
      } else if (cssProp === "filter") {
        decls.push(`filter: blur(${s.values.blur.toFixed(2)}px)`);
      } else if (cssProp === "letter-spacing") {
        decls.push(`letter-spacing: ${s.values.letterSpacing.toFixed(2)}px`);
      }
      return `${s.pct.toFixed(2)}% { ${decls.join("; ")} }`;
    })
    .join("\n    ");
}

export function sampleTrack(track, sceneDurationMs) {
  // Public API kept for tests and measurement scripts.
  const repeat = track.repeat || "none";
  const keys = track.keys;
  const firstT = keys[0].tMs;
  const lastT = keys[keys.length - 1].tMs;
  const cycleLenMs = Math.max(1, lastT - firstT);
  const cssPeriodMs = repeat === "pingpong" ? cycleLenMs / 2 : cycleLenMs;
  return {
    property: track.property,
    stops: sampleTrackForCss(track),
    firstT,
    lastT,
    cycleLenMs,
    cssPeriodMs,
    repeat
  };
}

export function compileTimelineCss(timeline) {
  let css = `/* Hermest Animation Engine CSS — generated */\n`;
  css += `:root { --duration: ${(timeline.durationMs / 1000).toFixed(3)}s; }\n`;

  for (const scene of timeline.scenes || []) {
    for (const layer of scene.layers || []) {
      if (layer.id === "__scene") continue;
      if (layer.id === "__camera") continue;

      // Group tracks by final CSS property.
      const groups = new Map();
      for (const track of layer.tracks || []) {
        if (!SUPPORTED_CSS_PROPS.has(track.property)) continue;
        if (!Array.isArray(track.keys) || track.keys.length === 0) continue;
        const cssProp = PROP_CSS_NAME[track.property] || track.property;
        if (!groups.has(cssProp)) groups.set(cssProp, []);
        groups.get(cssProp).push(track);
      }

      if (groups.size === 0) continue;

      const keyframeBlocks = [];
      const animationItems = [];
      let index = 0;

      const hasSceneLayer = scene.layers.some(l => l.id === "__scene");

      for (const [cssProp, tracks] of groups) {
        // Single-track groups for a CSS property use the cheap key-based sampler.
        // Core-sampling is used for real conflicts (multiple tracks), transform
        // (always composite), and any property affected by __scene transitions/camera.
        const useCoreSample = tracks.length > 1 || cssProp === "transform" ||
          (hasSceneLayer && (cssProp === "opacity" || cssProp === "filter" || cssProp === "letter-spacing"));

        if (!useCoreSample) {
          const res = buildSingleTrackAnimation(tracks[0], scene.id, layer.id, cssProp, index++);
          if (res) {
            keyframeBlocks.push(res.keyframeBlock);
            animationItems.push(res.animDecl);
          }
        } else {
          const res = buildCoreSampledAnimation(timeline, scene, layer, cssProp, scene.id, index++);
          if (res) {
            keyframeBlocks.push(res.keyframeBlock);
            animationItems.push(res.animDecl);
          }
        }
      }

      if (animationItems.length === 0) continue;

      css += keyframeBlocks.join("\n") + "\n";
      css += `.layer-${layer.id} {\n  animation: ${animationItems.join(",\n           ")};\n}\n`;
    }
  }

  return css;
}
