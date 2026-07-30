import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { THEME, clampText, escapeHtml } from "./scene-design.js";

export const PRESENTER_ANGLES = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315]);
export const PRESENTER_REST_HEIGHT_RATIO = 0.62;
export const PRESENTER_FLOOR_RATIO = 0.88;
export const PRESENTER_MAX_MOVE_SPEED_AT_1080 = 260;
export const PRESENTER_MAX_WINDOW_WIDTH_RATIO = 0.4;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ASSETS_ROOT = path.join(ROOT, "assets", "presenters");
const LINK_MS = 200;
const WINDOW_MS = 260;
const HARD_CUT_MS = 1;
const GESTURE_NEAR_CENTER_RATIO = 0.08;
const BLINK_MS = 120;
const MOUTH_PATTERN = Object.freeze(["open", "mid", "closed", "mid", "open", "open", "mid", "closed"]);
const CINEMATIC_EASING = "cubic-bezier(.18,.04,.2,1)";
// Доли кадра позы, где находится кисть. Замерено по силуэту готовых кадров, а
// не подобрано на глаз: позы стали полноростовыми, и прежние числа от поясного
// набора выводили линию-связку из пустого места рядом с рукой.
const GESTURE_HAND_ANCHORS = Object.freeze({
  pointLeft: Object.freeze({ x: 0.124, y: 0.372 }),
  handUp: Object.freeze({ x: 0.243, y: 0.367 })
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const asFraction = (value, fallback) => Number.isFinite(Number(value)) ? clamp(Number(value), 0, 1) : fallback;
const asMs = (value, fallback = 0) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
const normalizeAngle = value => ((Number(value) % 360) + 360) % 360;
const circularDistance = (left, right) => Math.abs(((left - right + 540) % 360) - 180);

export function calculatePresenterAngle({ presenterCenter, windowCenter } = {}) {
  const coordinates = [presenterCenter?.x, presenterCenter?.y, windowCenter?.x, windowCenter?.y].map(Number);
  if (!coordinates.every(Number.isFinite)) throw new TypeError("Presenter and window centers require finite x and y coordinates");
  const [fromX, fromY, toX, toY] = coordinates;
  if (fromX === toX && fromY === toY) return 0;
  return normalizeAngle(Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI);
}

export function nearestPresenterAngle(angle) {
  const target = normalizeAngle(angle);
  return PRESENTER_ANGLES.reduce((best, candidate) =>
    circularDistance(candidate, target) < circularDistance(best, target) ? candidate : best
  );
}

function turnSet(atlas) {
  return atlas?.turn || atlas;
}

function atlasSet(atlas, name) {
  return name === "turn" ? turnSet(atlas) : atlas?.[name] || null;
}

function assertAtlas(atlas) {
  const turn = turnSet(atlas);
  if (!turn || typeof turn !== "object" || !Array.isArray(turn.frames) || !turn.frames.length) {
    throw new TypeError("Presenter atlas requires a non-empty turn frames list");
  }
  if (!(Number(turn.frameWidth) > 0) || !(Number(turn.frameHeight) > 0)) {
    throw new TypeError("Presenter atlas requires positive turn frameWidth and frameHeight");
  }
  for (const name of ["walk", "gesture", "speak"]) {
    const set = atlasSet(atlas, name);
    if (!set) continue;
    if (!(Number(set.frameWidth) > 0) || !(Number(set.frameHeight) > 0)) {
      throw new TypeError("Presenter atlas requires positive " + name + " frame dimensions");
    }
  }
  const speak = atlasSet(atlas, "speak");
  if (speak) {
    const mouth = speak.mouth;
    if (!mouth || !["closed", "mid", "open"].every(shape => Array.isArray(mouth[shape]) && mouth[shape].length)
      || !Array.isArray(speak.blink) || !speak.blink.length) {
      throw new TypeError("Presenter speak atlas requires closed, mid, open and blink frames");
    }
  }
  return atlas;
}

function presenterId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(id)) throw new TypeError("Presenter id must contain only letters, numbers, _ or -");
  return id;
}

function closestAtlasFrame(atlas, angle) {
  const frames = atlas.frames
    .filter(frame => frame && typeof frame.file === "string" && Number.isFinite(Number(frame.angle)))
    .map(frame => ({ angle: normalizeAngle(frame.angle), file: frame.file }));
  const selected = frames.reduce((best, frame) =>
    !best || circularDistance(frame.angle, angle) < circularDistance(best.angle, angle) ? frame : best, null);
  if (!selected) throw new TypeError("Presenter atlas has no usable angle frames");
  return selected;
}

function assetPath(root, set, file) {
  const candidate = path.resolve(root, set.dir || ".", file);
  if (!candidate.startsWith(root + path.sep)) throw new Error("Presenter atlas asset escapes its directory: " + file);
  return candidate;
}

export function loadPresenterAtlas(id, { assetsRoot = DEFAULT_ASSETS_ROOT } = {}) {
  const safeId = presenterId(id);
  const root = path.resolve(assetsRoot, safeId);
  const atlasPath = path.join(root, "atlas.json");
  if (!existsSync(atlasPath)) throw new Error('Presenter atlas is missing for "' + safeId + '" at ' + atlasPath);
  let atlas;
  try {
    atlas = JSON.parse(readFileSync(atlasPath, "utf8"));
  } catch (error) {
    throw new Error('Presenter atlas for "' + safeId + '" is unreadable: ' + error.message);
  }
  assertAtlas(atlas);
  if (atlas.id && atlas.id !== safeId) throw new Error('Presenter atlas id "' + atlas.id + '" does not match requested presenter "' + safeId + '"');
  const turn = turnSet(atlas);
  for (const angle of PRESENTER_ANGLES) {
    const frame = closestAtlasFrame(turn, angle);
    if (!existsSync(assetPath(root, turn, frame.file))) {
      throw new Error('Presenter atlas for "' + safeId + '" is missing the ' + angle + ' degree frame (' + frame.file + ')');
    }
  }
  for (const name of ["walk", "gesture"]) {
    const set = atlasSet(atlas, name);
    if (!set) continue;
    const files = name === "gesture" ? Object.values(set.poses || {}) : set.frames;
    if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== "string" || !existsSync(assetPath(root, set, file)))) {
      throw new Error('Presenter atlas for "' + safeId + '" has unusable ' + name + " assets");
    }
  }
  const speak = atlasSet(atlas, "speak");
  if (speak) {
    const files = [...(speak.frames || []), ...Object.values(speak.mouth || {}).flat(), ...(speak.blink || [])];
    if (!files.length || files.some(file => typeof file !== "string" || !existsSync(assetPath(root, speak, file)))) {
      throw new Error('Presenter atlas for "' + safeId + '" has unusable speak assets');
    }
  }
  return { ...atlas, root };
}

function setGeometry(atlas, name, fullHeight, floorY) {
  const set = atlasSet(atlas, name);
  if (!set) return null;
  const ratio = Number(atlas?.figureHeightRatio?.[name]) || 1;
  const footAnchor = Number(atlas?.footAnchor?.[name]);
  const imageHeight = fullHeight / ratio;
  const imageWidth = imageHeight * Number(set.frameWidth) / Number(set.frameHeight);
  const anchor = Number.isFinite(footAnchor) ? clamp(footAnchor, 0, 1) : 1;
  const top = floorY - imageHeight * anchor;
  return {
    name, set, ratio, footAnchor: anchor, imageWidth, imageHeight, top,
    footY: top + imageHeight * anchor, effectiveFigureHeight: imageHeight * ratio
  };
}

function stageGeometry(frameWidth, frameHeight, atlas) {
  const figureHeight = frameHeight * PRESENTER_REST_HEIGHT_RATIO;
  const floorY = frameHeight * PRESENTER_FLOOR_RATIO;
  const sets = Object.fromEntries(["turn", "walk", "gesture", "speak"]
    .map(name => [name, setGeometry(atlas, name, figureHeight, floorY)])
    .filter(([, geometry]) => geometry));
  const width = Math.ceil(Math.max(...Object.values(sets).map(set => set.imageWidth)));
  return {
    width, height: figureHeight, top: floorY - figureHeight, floorY, figureHeight, sets
  };
}

function windowGeometry(raw, frameWidth, frameHeight) {
  const maxWidth = Math.floor(frameWidth * PRESENTER_MAX_WINDOW_WIDTH_RATIO);
  const width = Math.max(1, Math.min(maxWidth, Math.round(frameWidth * 0.36)));
  const lines = Array.isArray(raw?.lines) ? raw.lines.length : 0;
  const height = Math.min(Math.max(88, Math.floor(frameHeight * 0.31)), Math.max(88, Math.round(frameHeight * 0.105 + Math.max(1, Math.min(lines, 5)) * frameHeight * 0.038)));
  const centerX = clamp(asFraction(raw?.x, 0.5) * frameWidth, width / 2, frameWidth - width / 2);
  const centerY = clamp(asFraction(raw?.y, 0.5) * frameHeight, height / 2, frameHeight - height / 2);
  return { x: Math.round(centerX - width / 2), y: Math.round(centerY - height / 2), width, height, center: { x: Math.round(centerX), y: Math.round(centerY) } };
}

function key(atMs, value, easing) {
  return easing ? { atMs: Math.round(atMs), value, easing } : { atMs: Math.round(atMs), value };
}

function lineBox(from, to) {
  const x = Math.floor(Math.min(from.x, to.x));
  const y = Math.floor(Math.min(from.y, to.y));
  return {
    x, y, width: Math.max(1, Math.ceil(Math.abs(to.x - from.x))), height: Math.max(1, Math.ceil(Math.abs(to.y - from.y))),
    from: { x: from.x - x, y: from.y - y }, to: { x: to.x - x, y: to.y - y }
  };
}

function push(track, atMs, value, easing) {
  track.push(key(atMs, value, easing));
}

function gestureForWindow({ centerX, window, frameWidth, geometry }) {
  const centered = Math.abs(window.center.x - centerX) <= frameWidth * GESTURE_NEAR_CENTER_RATIO;
  const pose = centered ? "handUp" : "pointLeft";
  const mirrored = pose === "pointLeft" && window.center.x > centerX;
  const anchor = GESTURE_HAND_ANCHORS[pose];
  const rawX = mirrored ? 1 - anchor.x : anchor.x;
  const left = centerX - geometry.imageWidth / 2;
  return {
    pose, mirrored,
    hand: { x: Math.round(left + geometry.imageWidth * rawX), y: Math.round(geometry.top + geometry.imageHeight * anchor.y) }
  };
}

function addAsset(layers, assets, id, data) {
  layers[id] = { opacity: [key(0, 0)] };
  assets.push({ id, ...data });
}

function switchAsset({ layers, hardCuts, from, to, atMs }) {
  if (from === to) return to;
  const endMs = atMs + HARD_CUT_MS;
  push(layers[from].opacity, atMs, 1);
  push(layers[from].opacity, endMs, 0);
  push(layers[to].opacity, atMs, 0);
  push(layers[to].opacity, endMs, 1);
  hardCuts.push({ from, to, atMs, endMs });
  return to;
}

function seededValue(seed) {
  let state = (Number.isSafeInteger(seed) ? seed : 1) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function randomMs(random, min, max, previous = []) {
  let value = Math.round(min + random() * (max - min));
  // Одинаковые интервалы допустимы, но четыре подряд превращают речь в метроном.
  if (previous.length >= 3 && previous.slice(-3).every(item => item === value)) {
    value = value === max ? min : value + 1;
  }
  return value;
}

function buildSpeechPlan({ speak, durationMs, narrationDurationMs, seed }) {
  if (!speak) return { durationMs: 0, cues: [], blinks: [] };
  const speechDuration = clamp(asMs(narrationDurationMs, durationMs), 0, durationMs);
  if (!speechDuration) return { durationMs: 0, cues: [], blinks: [] };
  const random = seededValue(seed);
  const cues = [];
  const intervals = [];
  let atMs = 0;
  let index = Math.floor(random() * MOUTH_PATTERN.length);
  let formCount = 0;
  let nextPauseAfter = 4 + Math.floor(random() * 4);
  let fileOffsets = Object.fromEntries(Object.keys(speak.mouth).map(shape => [shape, Math.floor(random() * speak.mouth[shape].length)]));
  while (atMs < speechDuration) {
    const pauseAfter = formCount + 1 === nextPauseAfter;
    const shape = pauseAfter ? "closed" : MOUTH_PATTERN[(index + Math.floor(formCount / MOUTH_PATTERN.length)) % MOUTH_PATTERN.length];
    const files = speak.mouth[shape] || speak.mouth.closed;
    const fileOffset = fileOffsets[shape]++;
    const normalDuration = randomMs(random, 110, 150, intervals);
    // После 4–7 форм — естественный вдох. Он остаётся закрытым, а не отдельной
    // позой, поэтому глаза и голова не получают лишнего переключения.
    const duration = shape === "closed" && pauseAfter ? randomMs(random, 260, 420, intervals) : normalDuration;
    const endMs = Math.min(speechDuration, atMs + duration);
    cues.push({ startMs: atMs, endMs, shape, file: files[fileOffset % files.length], durationMs: endMs - atMs });
    intervals.push(endMs - atMs);
    atMs = endMs;
    formCount += 1;
    if (pauseAfter) nextPauseAfter += 4 + Math.floor(random() * 4);
    index += 1;
  }

  const closed = cues.filter(cue => cue.shape === "closed" && cue.durationMs >= BLINK_MS);
  const blinks = [];
  let blinkIndex = 0;
  let previousStartMs = 0;
  while (previousStartMs + 3000 <= speechDuration && closed.length) {
    const minMs = previousStartMs + 3000;
    const maxMs = Math.min(previousStartMs + 5500, speechDuration);
    const requestedAtMs = randomMs(random, minMs, Math.min(previousStartMs + 4800, maxMs));
    const candidates = closed
      .filter(cue => cue.startMs >= minMs && cue.startMs <= maxMs)
      .map(cue => ({ cue, distance: Math.abs(cue.startMs - requestedAtMs) }))
      .sort((left, right) => left.distance - right.distance || left.cue.startMs - right.cue.startMs);
    const selected = candidates[0];
    if (!selected) break;
    const startMs = selected.cue.startMs;
    blinks.push({ startMs, endMs: startMs + BLINK_MS, file: speak.blink[blinkIndex++ % speak.blink.length], durationMs: BLINK_MS });
    previousStartMs = startMs;
  }
  return { durationMs: speechDuration, cues, blinks };
}

function addLifeTracks(layers, durationMs, seed) {
  const random = seededValue(seed ^ 0x9E3779B9);
  const cycleMs = randomMs(random, 2400, 3200);
  const rotate = [key(0, 0)];
  const translateY = [key(0, 0)];
  for (let startMs = 0; startMs < durationMs; startMs += cycleMs) {
    const endMs = Math.min(durationMs, startMs + cycleMs);
    const span = endMs - startMs;
    for (const [fraction, rotation, y] of [[0.25, -0.8, -5], [0.5, 0.8, 5], [0.75, -0.45, -3], [1, 0, 0]]) {
      const atMs = Math.round(startMs + span * fraction);
      if (atMs > 0 && atMs <= durationMs) {
        push(rotate, atMs, rotation, "inOutCubic");
        push(translateY, atMs, y, "inOutCubic");
      }
    }
  }
  layers["presenter-life"] = { rotate, translateY };
  return cycleMs;
}

function buildPresenterCamera({ durationMs, frameWidth, beats }) {
  const window = beats[0]?.window;
  // Чтобы посмотреть вправо, содержимое едет влево: центр камеры остаётся на
  // открытом окне, а края кадра закрывает дополнительный масштаб.
  const direction = !window || window.center.x === frameWidth / 2 ? 0 : window.center.x > frameWidth / 2 ? -1 : 1;
  const scale = 1.035;
  const tx = direction * ((scale - 1) / 2) * frameWidth;
  return {
    direction: direction < 0 ? "right" : direction > 0 ? "left" : "center",
    scale: [key(0, 1), key(durationMs, scale, "cinematic")],
    translateX: [key(0, 0), key(durationMs, tx, "cinematic")],
    translateY: [key(0, 0), key(durationMs, 0, "cinematic")]
  };
}

export function buildPresenterTimeline({ beats, frameWidth, frameHeight, atlas, startX = 0.5, durationMs, narrationDurationMs, seed = 1 } = {}) {
  const width = Number(frameWidth);
  const height = Number(frameHeight);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError("Presenter stage requires positive integer frame dimensions");
  }
  assertAtlas(atlas);
  const presenter = stageGeometry(width, height, atlas);
  const minCenterX = presenter.width / 2;
  const maxCenterX = width - presenter.width / 2;
  const maxMoveSpeed = PRESENTER_MAX_MOVE_SPEED_AT_1080 * height / 1080;
  const initialCenterX = clamp(asFraction(startX, 0.5) * width, minCenterX, maxCenterX);
  const usable = (Array.isArray(beats) ? beats : [])
    .filter(beat => beat && typeof beat === "object" && beat.window && typeof beat.window === "object")
    .map((beat, index) => ({ ...beat, index, atMs: asMs(beat.atMs) }))
    .sort((left, right) => left.atMs - right.atMs || left.index - right.index);
  let previousCenterX = initialCenterX;
  let previousMoveEndMs = 0;
  const planned = usable.map(beat => {
    const centerX = clamp(asFraction(beat.moveTo, previousCenterX / width) * width, minCenterX, maxCenterX);
    const distancePx = Math.abs(centerX - previousCenterX);
    const moveDurationMs = distancePx ? Math.ceil(distancePx / maxMoveSpeed * 1000) : 0;
    const moveStartMs = distancePx ? Math.max(previousMoveEndMs, beat.atMs - moveDurationMs) : beat.atMs;
    const moveEndMs = moveStartMs + moveDurationMs;
    const window = windowGeometry(beat.window, width, height);
    const center = { x: Math.round(centerX), y: Math.round(presenter.top + presenter.figureHeight / 2) };
    const angle = nearestPresenterAngle(calculatePresenterAngle({ presenterCenter: center, windowCenter: window.center }));
    const gesture = presenter.sets.gesture ? gestureForWindow({ centerX, window, frameWidth: width, geometry: presenter.sets.gesture }) : null;
    const hand = gesture?.hand || { x: center.x, y: Math.round(presenter.top + presenter.figureHeight * 0.56) };
    const edge = { x: clamp(hand.x, window.x, window.x + window.width), y: clamp(hand.y, window.y, window.y + window.height) };
    previousCenterX = centerX;
    previousMoveEndMs = moveEndMs;
    return {
      ...beat, centerX: Math.round(centerX), angle, window, hand, edge, gesture, link: lineBox(hand, edge),
      moveStartMs, moveEndMs, moveDurationMs, distancePx, speedPxPerSecond: moveDurationMs ? distancePx / moveDurationMs * 1000 : 0,
      linkStartMs: moveEndMs, linkEndMs: moveEndMs + LINK_MS,
      windowStartMs: moveEndMs + LINK_MS, windowEndMs: moveEndMs + LINK_MS + WINDOW_MS
    };
  });
  const requiredDuration = Math.max(1000, ...planned.map(beat => beat.windowEndMs));
  const requestedDuration = durationMs === undefined ? null : asMs(durationMs);
  if (requestedDuration !== null && requestedDuration < requiredDuration) {
    throw new RangeError("Presenter movement needs " + requiredDuration + "ms at or below " + Math.round(maxMoveSpeed) + "px/s, but the scene allows " + requestedDuration + "ms");
  }
  const duration = requestedDuration ?? requiredDuration;
  const layers = {
    presenter: { translateX: [key(0, Math.round(initialCenterX - presenter.width / 2))], translateY: [key(0, 0)] },
    "presenter-breath": { scaleY: [key(0, 1), key(2000, 1.006), key(4000, 1)] }
  };
  const lifeCycleMs = addLifeTracks(layers, duration, seed);
  const assets = [];
  const turn = turnSet(atlas);
  for (const angle of PRESENTER_ANGLES) addAsset(layers, assets, "presenter-a" + angle, { type: "turn", angle, frame: closestAtlasFrame(turn, angle), geometry: presenter.sets.turn });
  const walkIds = [];
  const walk = atlasSet(atlas, "walk");
  if (walk?.frames?.length) for (const [index, file] of walk.frames.entries()) {
    const id = "presenter-walk-" + index;
    walkIds.push(id);
    addAsset(layers, assets, id, { type: "walk", frame: { file }, geometry: presenter.sets.walk });
  }
  for (const beat of planned) {
    if (!beat.gesture) continue;
    const file = atlasSet(atlas, "gesture")?.poses?.[beat.gesture.pose];
    if (!file) continue;
    beat.gesture.layerId = "presenter-g-" + (beat.index + 1);
    addAsset(layers, assets, beat.gesture.layerId, { type: "gesture", frame: { file }, geometry: presenter.sets.gesture, mirrored: beat.gesture.mirrored });
  }
  const speak = atlasSet(atlas, "speak");
  const speech = buildSpeechPlan({ speak, durationMs: duration, narrationDurationMs, seed });
  const mouthIds = new Map();
  const blinkIds = new Map();
  if (speak) {
    const closedFile = speak.mouth.closed[0];
    const closedId = "presenter-speak-closed-" + closedFile.replace(/[^a-z0-9]+/giu, "-");
    mouthIds.set(closedId, closedId);
    addAsset(layers, assets, closedId, { type: "speak", shape: "closed", frame: { file: closedFile }, geometry: presenter.sets.speak });
    speech.closedLayerId = closedId;
    for (const cue of speech.cues) {
      const id = "presenter-speak-" + cue.shape + "-" + cue.file.replace(/[^a-z0-9]+/giu, "-");
      if (!mouthIds.has(id)) {
        mouthIds.set(id, id);
        addAsset(layers, assets, id, { type: "speak", shape: cue.shape, frame: { file: cue.file }, geometry: presenter.sets.speak });
      }
      cue.layerId = id;
    }
    for (const blink of speech.blinks) {
      const id = "presenter-blink-" + blink.file.replace(/[^a-z0-9]+/giu, "-");
      if (!blinkIds.has(id)) {
        blinkIds.set(id, id);
        addAsset(layers, assets, id, { type: "blink", frame: { file: blink.file }, geometry: presenter.sets.speak });
      }
      blink.layerId = id;
    }
  }
  let fromCenterX = initialCenterX;
  for (const beat of planned) {
    push(layers.presenter.translateX, beat.moveStartMs, Math.round(fromCenterX - presenter.width / 2));
    push(layers.presenter.translateX, beat.moveEndMs, Math.round(beat.centerX - presenter.width / 2), "linear");
    layers["link-" + (beat.index + 1)] = { clipReveal: [key(0, 0), key(beat.linkStartMs, 0), key(beat.linkEndMs, 1, "inOutCubic")] };
    layers["window-" + (beat.index + 1)] = {
      opacity: [key(0, 0), key(beat.windowStartMs, 0), key(beat.windowEndMs, 1, "inOutCubic")],
      scale: [key(0, 0.94), key(beat.windowStartMs, 0.94), key(beat.windowEndMs, 1, "inOutCubic")],
      clipReveal: [key(0, 0), key(beat.windowStartMs, 0), key(beat.windowEndMs, 1, "inOutCubic")]
    };
    fromCenterX = beat.centerX;
  }
  const turnAt = atMs => planned.filter(beat => beat.moveEndMs <= atMs).at(-1)?.angle ?? planned[0]?.angle ?? 0;
  const assetAt = atMs => {
    const walkBeat = planned.find(beat => beat.moveDurationMs && atMs >= beat.moveStartMs && atMs < beat.moveEndMs);
    if (walkBeat && walkIds.length) {
      const index = Math.floor((atMs - walkBeat.moveStartMs) / (asMs(walk.frameDurationMs, 75) || 75)) % walkIds.length;
      return walkIds[index];
    }
    const gestureBeat = planned.find(beat => beat.gesture?.layerId && atMs >= beat.windowStartMs && atMs < beat.windowEndMs);
    if (gestureBeat) return gestureBeat.gesture.layerId;
    const blink = speech.blinks.find(item => atMs >= item.startMs && atMs < item.endMs);
    if (blink) return blink.layerId;
    const cue = speech.cues.find(item => atMs >= item.startMs && atMs < item.endMs);
    if (cue) return cue.layerId;
    if (speech.durationMs > 0 && speech.closedLayerId && atMs >= speech.durationMs) return speech.closedLayerId;
    return "presenter-a" + turnAt(atMs);
  };
  const switchTimes = new Set();
  for (const beat of planned) {
    switchTimes.add(beat.moveStartMs);
    switchTimes.add(beat.moveEndMs);
    switchTimes.add(beat.windowStartMs);
    switchTimes.add(beat.windowEndMs);
    if (beat.moveDurationMs && walkIds.length) {
      const frameDuration = asMs(walk.frameDurationMs, 75) || 75;
      for (let atMs = beat.moveStartMs + frameDuration; atMs < beat.moveEndMs; atMs += frameDuration) switchTimes.add(atMs);
    }
  }
  for (const cue of speech.cues) switchTimes.add(cue.startMs);
  switchTimes.add(speech.durationMs);
  for (const blink of speech.blinks) {
    switchTimes.add(blink.startMs);
    switchTimes.add(blink.endMs);
  }
  const initial = assetAt(0);
  layers[initial].opacity[0].value = 1;
  let active = initial;
  const hardCuts = [];
  for (const atMs of [...switchTimes].filter(atMs => atMs > 0 && atMs < duration).sort((left, right) => left - right)) {
    active = switchAsset({ layers, hardCuts, from: active, to: assetAt(Math.min(duration, atMs + HARD_CUT_MS)), atMs });
  }
  const camera = buildPresenterCamera({ durationMs: duration, frameWidth: width, beats: planned });
  for (const layer of Object.values(layers)) for (const track of Object.values(layer)) {
    track.sort((left, right) => left.atMs - right.atMs);
    if (track.at(-1).atMs < duration) push(track, duration, track.at(-1).value);
  }
  return { durationMs: duration, frame: { width, height }, presenter: { ...presenter, minCenterX, maxCenterX, maxMoveSpeed }, beats: planned, assets, layers, hardCuts, speech, life: { cycleMs: lifeCycleMs }, camera };
}

export function evaluatePresenterOpacity(timeline, atMs) {
  const time = clamp(Number(atMs) || 0, 0, timeline.durationMs);
  const assetIds = Array.isArray(timeline.assets)
    ? timeline.assets.map(asset => asset.id)
    : PRESENTER_ANGLES.map(angle => "presenter-a" + angle);
  return Object.fromEntries(assetIds
    .map(id => {
      const layer = timeline.layers[id];
      const track = layer.opacity;
      let previous = track[0];
      let next = null;
      for (const point of track) {
        if (point.atMs <= time) previous = point;
        if (point.atMs > time) { next = point; break; }
      }
      const value = next ? previous.value + (next.value - previous.value) * (time - previous.atMs) / (next.atMs - previous.atMs) : previous.value;
      return [id, value];
    }));
}

function latest(track, atMs) {
  return track.filter(point => point.atMs <= atMs).at(-1)?.value ?? track[0].value;
}

function percent(atMs, duration) {
  return ((atMs / duration) * 100).toFixed(4) + "%";
}

function cssKeyframes(name, frames, duration, declarations) {
  const compact = [];
  for (const frame of frames) {
    if (compact.at(-1)?.atMs === frame.atMs) compact[compact.length - 1] = frame;
    else compact.push(frame);
  }
  return "@keyframes " + name + " { " + compact.map(frame =>
    percent(frame.atMs, duration) + " { " + declarations(frame.value) +
    (frame.easing === "inOutCubic" ? ";animation-timing-function:cubic-bezier(.645,.045,.355,1)" : "") + "; }"
  ).join(" ") + " }";
}

function assetMarkup(asset, root, presenter) {
  const source = root ? pathToFileURL(assetPath(root, asset.geometry.set, asset.frame.file)).href : path.posix.join(asset.geometry.set.dir || ".", asset.frame.file);
  const left = (presenter.width - asset.geometry.imageWidth) / 2;
  const top = asset.geometry.top - presenter.top;
  const transform = asset.mirrored ? "transform:scaleX(-1);" : "";
  return '<img class="presenter-asset" data-layer-id="' + asset.id + '" alt="" src="' + escapeHtml(source) + '" style="left:' + left.toFixed(3) + 'px;top:' + top.toFixed(3) + 'px;width:' + asset.geometry.imageWidth.toFixed(3) + 'px;height:' + asset.geometry.imageHeight.toFixed(3) + 'px;' + transform + '">';
}

export function renderPresenterMarkup({ timeline, atlas, beats, originX = 0, originY = 0 } = {}) {
  assertAtlas(atlas);
  if (!timeline?.layers) throw new TypeError("Presenter markup requires a timeline");
  const root = atlas.root || "";
  const images = timeline.assets.map(asset => assetMarkup(asset, root, timeline.presenter)).join("");
  const windows = timeline.beats.map(beat => {
    const index = beat.index + 1;
    const raw = beats?.[beat.index]?.window ?? beat.window ?? {};
    const title = clampText(raw.title, 56);
    const lines = Array.isArray(raw.lines) ? raw.lines.slice(0, 5).map(line => clampText(line, 72)).filter(Boolean) : [];
    return '<svg class="presenter-link" data-layer-id="link-' + index + '" aria-hidden="true" style="left:' + beat.link.x + 'px;top:' + beat.link.y + 'px;width:' + beat.link.width + 'px;height:' + beat.link.height + 'px" viewBox="0 0 ' + beat.link.width + ' ' + beat.link.height + '"><line x1="' + beat.link.from.x + '" y1="' + beat.link.from.y + '" x2="' + beat.link.to.x + '" y2="' + beat.link.to.y + '"></line></svg>' +
      '<section class="presenter-window" data-layer-id="window-' + index + '" style="left:' + beat.window.x + 'px;top:' + beat.window.y + 'px;width:' + beat.window.width + 'px;height:' + beat.window.height + 'px"><div class="presenter-window-bar"><span></span><span></span><span></span><b>HERMEST BOARD</b></div>' +
      (title ? '<h2>' + escapeHtml(title) + '</h2>' : "") + '<ul>' + lines.map(line => '<li>' + escapeHtml(line) + '</li>').join("") + '</ul></section>';
  }).join("");
  return '<div class="presenter-stage" style="left:' + Number(originX) + 'px;top:' + Number(originY) + 'px;width:' + timeline.frame.width + 'px;height:' + timeline.frame.height + 'px"><div class="presenter-camera" data-layer-id="presenter-camera"><div class="presenter" data-layer-id="presenter" style="top:' + timeline.presenter.top.toFixed(3) + 'px;width:' + timeline.presenter.width + 'px;height:' + timeline.presenter.height.toFixed(3) + 'px"><div class="presenter-life" data-layer-id="presenter-life"><div class="presenter-breath" data-layer-id="presenter-breath">' + images + '</div></div></div>' + windows + '</div></div>';
}

export function presenterStageCss({ timeline } = {}) {
  if (!timeline?.layers) throw new TypeError("Presenter CSS requires a timeline");
  const duration = timeline.durationMs;
  const finalX = latest(timeline.layers.presenter.translateX, duration);
  const finalY = latest(timeline.layers.presenter.translateY, duration);
  const times = [...new Set([...timeline.layers.presenter.translateX, ...timeline.layers.presenter.translateY].map(point => point.atMs))].sort((a, b) => a - b);
  const move = times.map(atMs => ({ atMs, value: { x: latest(timeline.layers.presenter.translateX, atMs), y: latest(timeline.layers.presenter.translateY, atMs) } }));
  const lifeTimes = [...new Set([...timeline.layers["presenter-life"].rotate, ...timeline.layers["presenter-life"].translateY].map(point => point.atMs))].sort((a, b) => a - b);
  const life = lifeTimes.map(atMs => ({ atMs, value: { rotate: latest(timeline.layers["presenter-life"].rotate, atMs), y: latest(timeline.layers["presenter-life"].translateY, atMs) } }));
  const cameraTimes = [...new Set([...timeline.camera.scale, ...timeline.camera.translateX, ...timeline.camera.translateY].map(point => point.atMs))].sort((a, b) => a - b);
  const camera = cameraTimes.map(atMs => ({ atMs, value: { scale: latest(timeline.camera.scale, atMs), x: latest(timeline.camera.translateX, atMs), y: latest(timeline.camera.translateY, atMs) } }));
  const scale = timeline.frame.height / 1080;
  const px = value => (value * scale).toFixed(3) + "px";
  const css = [
    ".presenter-stage { position:absolute; overflow:hidden; pointer-events:none; }",
    ".presenter-camera { position:absolute; inset:0; transform:translateX(" + latest(timeline.camera.translateX, duration) + "px) translateY(" + latest(timeline.camera.translateY, duration) + "px) scale(" + latest(timeline.camera.scale, duration) + "); transform-origin:50% 50%; animation:presenter-stage-camera " + duration + "ms " + CINEMATIC_EASING + " both; }",
    ".presenter { position:absolute; left:0; transform:translateX(" + finalX + "px) translateY(" + finalY + "px); transform-origin:50% 100%; animation:presenter-stage-move " + duration + "ms linear both; }",
    ".presenter-life { position:absolute; inset:0; transform:translateY(" + latest(timeline.layers["presenter-life"].translateY, duration) + "px) rotate(" + latest(timeline.layers["presenter-life"].rotate, duration) + "deg); transform-origin:50% 100%; animation:presenter-stage-life " + duration + "ms linear both; }",
    ".presenter-breath { position:absolute; inset:0; overflow:visible; transform-origin:50% 100%; animation:presenter-stage-breath 4000ms ease-in-out infinite; }",
    ".presenter-asset { position:absolute; object-fit:fill; transform-origin:50% 50%; }",
    ".presenter-link { position:absolute; overflow:visible; fill:none; stroke:" + THEME.accentWarm + ";stroke-width:2;stroke-linecap:round; }",
    ".presenter-window { position:absolute; box-sizing:border-box; overflow:hidden; border:1px solid rgba(95,136,196,.76); border-radius:" + px(12) + "; background:rgba(8,18,35,.96); box-shadow:0 " + px(16) + " " + px(36) + " rgba(1,6,14,.48); color:" + THEME.text + "; padding:" + px(12) + " " + px(14) + "; transform-origin:50% 50%; }",
    ".presenter-window-bar { display:flex; align-items:center; gap:" + px(5) + "; color:" + THEME.textMuted + "; font-size:" + px(12) + "; letter-spacing:" + px(1.2) + "; } .presenter-window-bar span { width:" + px(7) + "; height:" + px(7) + "; border-radius:50%; background:" + THEME.accentAlt + "; } .presenter-window-bar span:nth-child(2) { background:" + THEME.accentWarm + "; } .presenter-window-bar span:nth-child(3) { background:" + THEME.accent + "; } .presenter-window-bar b { margin-left:" + px(4) + "; font-size:" + px(12) + "; } .presenter-window h2 { margin:" + px(11) + " 0 " + px(7) + "; font-size:" + px(34) + "; line-height:1.08; } .presenter-window ul { margin:0; padding:0; list-style:none; } .presenter-window li { color:" + THEME.textMuted + "; font-size:" + px(26) + "; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
    cssKeyframes("presenter-stage-move", move, duration, value => "transform:translateX(" + value.x + "px) translateY(" + value.y + "px)"),
    cssKeyframes("presenter-stage-life", life, duration, value => "transform:translateY(" + value.y + "px) rotate(" + value.rotate + "deg)"),
    cssKeyframes("presenter-stage-camera", camera, duration, value => "transform:translateX(" + value.x + "px) translateY(" + value.y + "px) scale(" + value.scale + ")"),
    "@keyframes presenter-stage-breath { 0%,100% { transform:scaleY(1); } 50% { transform:scaleY(1.006); } }"
  ];
  for (const asset of timeline.assets) {
    const finalOpacity = latest(timeline.layers[asset.id].opacity, duration);
    css.push(cssKeyframes("presenter-stage-" + asset.id, timeline.layers[asset.id].opacity, duration, value => "opacity:" + value));
    css.push('.presenter-breath [data-layer-id="' + asset.id + '"] { opacity:' + finalOpacity + "; animation:presenter-stage-" + asset.id + " " + duration + "ms linear both; }");
  }
  for (const beat of timeline.beats) {
    const index = beat.index + 1;
    const link = timeline.layers["link-" + index].clipReveal;
    const window = timeline.layers["window-" + index];
    const finalLinkReveal = latest(link, duration);
    css.push(cssKeyframes("presenter-stage-link-" + index, link, duration, value => "clip-path:inset(0 " + (100 - value * 100) + "% 0 0)"));
    css.push('.presenter-link[data-layer-id="link-' + index + '"] { clip-path:inset(0 ' + (100 - finalLinkReveal * 100) + "% 0 0); animation:presenter-stage-link-" + index + " " + duration + "ms linear both; }");
    const points = [...new Set([...window.opacity, ...window.scale, ...window.clipReveal].map(point => point.atMs))].sort((a, b) => a - b)
      .map(atMs => ({ atMs, value: { opacity: latest(window.opacity, atMs), scale: latest(window.scale, atMs), reveal: latest(window.clipReveal, atMs) } }));
    css.push(cssKeyframes("presenter-stage-window-" + index, points, duration, value => "opacity:" + value.opacity + ";transform:scale(" + value.scale + ");clip-path:inset(0 " + (100 - value.reveal * 100) + "% 0 0)"));
    const finalWindow = points.at(-1).value;
    css.push('.presenter-window[data-layer-id="window-' + index + '"] { opacity:' + finalWindow.opacity + "; transform:scale(" + finalWindow.scale + "); clip-path:inset(0 " + (100 - finalWindow.reveal * 100) + "% 0 0); animation:presenter-stage-window-" + index + " " + duration + "ms linear both; }");
  }
  return "\n  " + css.join("\n  ");
}
