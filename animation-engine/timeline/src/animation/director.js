/**
 * Режиссёр: из SceneIntent -> Timeline (конкретные треки).
 * Использует пресет, seed, beats, layout.
 * Вся случайность — через seededRandom, застывает в данных.
 *
 * Правки v3 (Ирис):
 * - Валидация SceneIntent: id, durationMs, элементы с kind и id.
 * - Камера: unknown move -> RangeError.
 * - Все длины приходят в ядро только в px (числа).
 */

import { seededRandom } from "./random.js";
import { getPreset } from "./presets.js";

const VALID_ELEMENT_KINDS = Object.freeze([
  "headline", "lead", "kicker", "body", "number", "panel", "caption"
]);

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randRange(rng, range) {
  return range.min + rng() * (range.max - range.min);
}

function snapToBeat(tMs, beats, windowMs) {
  if (!beats || beats.length === 0) return tMs;
  let best = tMs;
  let bestDist = Infinity;
  for (const beat of beats) {
    const dist = Math.abs(beat.tMs - tMs);
    if (dist < bestDist && dist <= windowMs) {
      bestDist = dist;
      best = beat.tMs;
    }
  }
  return best;
}

function findNearestBeat(tMs, beats, kind, windowMs) {
  if (!beats || windowMs <= 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const beat of beats) {
    if (beat.kind !== kind) continue;
    const dist = Math.abs(beat.tMs - tMs);
    if (dist <= windowMs && dist < bestDist) {
      bestDist = dist;
      best = beat;
    }
  }
  return best;
}

function validateIntent(intent) {
  if (!intent || typeof intent !== "object") {
    throw new TypeError("intent must be an object");
  }
  if (!intent.id || typeof intent.id !== "string") {
    throw new RangeError("intent.id must be a non-empty string");
  }
  if (!Number.isFinite(intent.durationMs) || intent.durationMs <= 0) {
    throw new RangeError("intent.durationMs must be finite and > 0");
  }
  for (let i = 0; i < (intent.elements || []).length; i++) {
    const el = intent.elements[i];
    if (!el.id || typeof el.id !== "string") {
      throw new RangeError(`intent.elements[${i}] must have string id`);
    }
    if (!VALID_ELEMENT_KINDS.includes(el.kind)) {
      throw new RangeError(
        `intent.elements[${i}] kind "${el.kind}" is unknown. ` +
        `Allowed: ${VALID_ELEMENT_KINDS.join(", ")}`
      );
    }
  }
}

function validateLayout(layout) {
  if (!layout || typeof layout !== "object") {
    throw new TypeError("layout must be an object");
  }
  if (!Number.isFinite(layout.width) || layout.width <= 0 ||
      !Number.isFinite(layout.height) || layout.height <= 0) {
    throw new RangeError("layout.width and layout.height must be finite and > 0");
  }
}

function buildElementTracks(element, preset, layout, rng, beats, sceneStartOffset, elementIndex, sceneDurationMs) {
  const tracks = [];
  const kind = element.kind;

  const enterDur = Math.round(randRange(rng, preset.enterDurationMs));
  const enterEase = preset.enterEasing;
  const enterDelay = Math.round(randRange(rng, preset.staggerMs));
  const enterY = Math.round(randRange(rng, preset.enterTranslateY));
  const enterX = Math.round(randRange(rng, preset.enterTranslateX));

  let actualEnterDelay = enterDelay;

  if (preset.useBeats === "accent" && beats) {
    const targetT = sceneStartOffset + actualEnterDelay;
    const nearest = findNearestBeat(targetT, beats, "accent", preset.accentSnapMs);
    if (nearest) {
      actualEnterDelay = Math.round(nearest.tMs - sceneStartOffset);
      actualEnterDelay = Math.max(0, actualEnterDelay);
    }
  } else if (preset.useBeats === "pause" && beats) {
    const targetT = sceneStartOffset + actualEnterDelay;
    const nearestPause = findNearestBeat(targetT, beats, "pause", 300);
    if (nearestPause && Math.abs(nearestPause.tMs - targetT) < 200) {
      actualEnterDelay += 250;
    }
  }

  tracks.push({
    property: "opacity",
    keys: [
      { tMs: actualEnterDelay, value: 0 },
      { tMs: actualEnterDelay + enterDur, value: 1, easing: enterEase }
    ]
  });

  tracks.push({
    property: "translateY",
    keys: [
      { tMs: actualEnterDelay, value: enterY },
      { tMs: actualEnterDelay + enterDur, value: 0, easing: enterEase }
    ]
  });

  if (enterX !== 0) {
    tracks.push({
      property: "translateX",
      keys: [
        { tMs: actualEnterDelay, value: enterX },
        { tMs: actualEnterDelay + enterDur, value: 0, easing: enterEase }
      ]
    });
  }

  if (kind === "number") {
    const fromVal = element.from ?? 0;
    const toVal = element.to ?? 100;
    const countDur = Math.min(enterDur * 2, 1200);
    tracks.push({
      property: "numberValue",
      keys: [
        { tMs: actualEnterDelay, value: fromVal },
        { tMs: actualEnterDelay + countDur, value: toVal, easing: "outQuint" }
      ],
      decimals: element.decimals ?? 0,
      thousands: element.thousands ?? " ",
      prefix: element.prefix ?? "",
      suffix: element.suffix ?? ""
    });
  }

  if (kind === "kicker") {
    tracks.push({
      property: "letterSpacing",
      keys: [
        { tMs: actualEnterDelay, value: 4 },
        { tMs: actualEnterDelay + enterDur, value: 0, easing: enterEase }
      ]
    });
  }

  if (kind === "panel") {
    tracks.push({
      property: "clipReveal",
      from: "left",
      keys: [
        { tMs: actualEnterDelay, value: 0 },
        { tMs: actualEnterDelay + enterDur, value: 1, easing: enterEase }
      ]
    });
  }

  if (preset.idleEnabled) {
    const idleAmp = kind === "headline" ? 6 : kind === "number" ? 5 : kind === "lead" ? 4 : 3;
    const idleSign = elementIndex % 2 === 0 ? 1 : -1;
    const idleDur = Math.min(preset.idleDurationMs, sceneDurationMs);
    const idleY = idleAmp * idleSign;

    tracks.push({
      property: "translateY",
      repeat: "loop",
      phaseMs: Math.round(rng() * idleDur),
      keys: [
        { tMs: 0, value: 0 },
        { tMs: idleDur / 2, value: idleY, easing: preset.idleEasing },
        { tMs: idleDur, value: 0, easing: preset.idleEasing }
      ]
    });
  }

  return { tracks, enterEndMs: actualEnterDelay + enterDur };
}

function buildAccentTracks(element, kind, enterEndMs, holdStartMs, holdEndMs, usedAccents, bodyAccentIds) {
  const tracks = [];
  if (holdEndMs - holdStartMs < 1200) return tracks;
  if (usedAccents.has(element.id)) return tracks;

  const holdDur = holdEndMs - holdStartMs;

  if (kind === "headline") {
    const start = Math.max(holdStartMs, enterEndMs);
    const end = holdEndMs;
    if (start < end) {
      tracks.push({
        property: "scale",
        accent: true,
        keys: [
          { tMs: start, value: 1 },
          { tMs: start + (end - start) / 2, value: 1.008, easing: "inOutCubic" },
          { tMs: end, value: 1, easing: "inOutCubic" }
        ]
      });
      usedAccents.add(element.id);
    }
  } else if (kind === "kicker") {
    const start = Math.max(holdStartMs, enterEndMs);
    const end = holdEndMs;
    if (start < end) {
      tracks.push({
        property: "letterSpacing",
        accent: true,
        keys: [
          { tMs: start, value: 0 },
          { tMs: start + (end - start) / 2, value: 0.6, easing: "inOutCubic" },
          { tMs: end, value: 0, easing: "inOutCubic" }
        ]
      });
      usedAccents.add(element.id);
    }
  } else if (kind === "number") {
    const earliestStart = Math.max(holdStartMs, enterEndMs + 120);
    const start = Math.min(earliestStart, holdEndMs - 320);
    if (start >= holdStartMs && start + 320 <= holdEndMs) {
      tracks.push({
        property: "scale",
        accent: true,
        keys: [
          { tMs: start, value: 1 },
          { tMs: start + 160, value: 1.02, easing: "outBack" },
          { tMs: start + 320, value: 1, easing: "outBack" }
        ]
      });
      usedAccents.add(element.id);
    }
  } else if (kind === "body") {
    const accentId = `body-accent-${element.id}`;
    if (usedAccents.has(accentId)) return tracks;
    const total = bodyAccentIds.length;
    const bodyCount = bodyAccentIds.filter(id => usedAccents.has(id)).length;
    const index = bodyCount;
    const slotDuration = holdDur / Math.max(1, total);
    const start = Math.max(holdStartMs, holdStartMs + slotDuration * index);
    const end = Math.min(start + 900, holdEndMs);
    if (start >= holdStartMs && end <= holdEndMs && start < end && end - start >= 600) {
      tracks.push({
        property: "translateX",
        accent: true,
        keys: [
          { tMs: start, value: 0 },
          { tMs: start + (end - start) / 2, value: 4, easing: "inOutCubic" },
          { tMs: end, value: 0, easing: "inOutCubic" }
        ]
      });
      usedAccents.add(accentId);
    }
  }

  return tracks;
}

const SAFE_ZONE_USAGE = 0.75;
const slackPct = s => (s - 1) / 2 * 100;
const offset = (dir, scale) => dir * SAFE_ZONE_USAGE * slackPct(scale);

const CAMERA_MOVES = Object.freeze([
  { id: "push-in",     from: { scale: 1,     x: 0,  y: 0  }, to: { scale: 1.045, x: 0,  y: -1   }, origin: "50% 46%" },
  { id: "drift-left",  from: { scale: 1.03,  x: 1,  y: 0  }, to: { scale: 1.048, x: -1, y: -0.5 }, origin: "42% 50%" },
  { id: "pull-back",   from: { scale: 1.055, x: 0,  y: 1  }, to: { scale: 1.006, x: 0,  y: 0    }, origin: "50% 52%" },
  { id: "drift-right", from: { scale: 1.03,  x: -1, y: 0  }, to: { scale: 1.048, x: 1,  y: -0.5 }, origin: "58% 50%" },
  { id: "rise",        from: { scale: 1.02,  x: 0,  y: 1  }, to: { scale: 1.05,  x: 0,  y: -1   }, origin: "50% 58%" }
]);

function buildCameraTracks(camera, preset, layout, rng, sceneDurationMs) {
  const tracks = [];
  if (!camera || !camera.move) return tracks;

  const moveId = camera.move;
  const move = CAMERA_MOVES.find(m => m.id === moveId);
  if (!move) {
    throw new RangeError(`Unknown camera move "${moveId}". Allowed: ${CAMERA_MOVES.map(m => m.id).join(", ")}`);
  }

  const peak = Math.max(move.from.scale, move.to.scale);
  const remap = s => 1 + (s - 1) * (preset.cameraScaleMax - 1) / (peak - 1);
  const fromScale = remap(move.from.scale);
  const toScale = remap(move.to.scale);

  const fromX = offset(move.from.x, fromScale);
  const fromY = offset(move.from.y, fromScale);
  const toX = offset(move.to.x, toScale);
  const toY = offset(move.to.y, toScale);

  const w = layout.width;
  const h = layout.height;

  const fromTx = Math.round(fromX * w / 100);
  const fromTy = Math.round(fromY * h / 100);
  const toTx = Math.round(toX * w / 100);
  const toTy = Math.round(toY * h / 100);

  const camDur = sceneDurationMs;

  tracks.push({
    property: "scale",
    keys: [
      { tMs: 0, value: fromScale },
      { tMs: camDur, value: toScale, easing: preset.cameraEasing }
    ]
  });

  tracks.push({
    property: "translateX",
    keys: [
      { tMs: 0, value: fromTx },
      { tMs: camDur, value: toTx, easing: preset.cameraEasing }
    ]
  });

  tracks.push({
    property: "translateY",
    keys: [
      { tMs: 0, value: fromTy },
      { tMs: camDur, value: toTy, easing: preset.cameraEasing }
    ]
  });

  return tracks;
}

function buildTransitionTracks(scene, preset) {
  const tracks = [];

  const tIn = scene.transitionIn || { kind: "none", durationMs: 0 };
  if (tIn.kind === "dissolve" && tIn.durationMs > 0) {
    tracks.push({
      property: "opacity",
      keys: [
        { tMs: 0, value: 0 },
        { tMs: tIn.durationMs, value: 1, easing: "outQuad" }
      ]
    });
    tracks.push({
      property: "scale",
      keys: [
        { tMs: 0, value: 0.98 },
        { tMs: tIn.durationMs, value: 1, easing: "outQuad" }
      ]
    });
  }

  const tOut = scene.transitionOut || { kind: "none", durationMs: 0 };
  if (tOut.kind === "dissolve" && tOut.durationMs > 0) {
    const startFade = scene.durationMs - tOut.durationMs;
    tracks.push({
      property: "opacity",
      keys: [
        { tMs: startFade, value: 1 },
        { tMs: scene.durationMs, value: 0, easing: "inQuad" }
      ]
    });
    tracks.push({
      property: "scale",
      keys: [
        { tMs: startFade, value: 1 },
        { tMs: scene.durationMs, value: 1.01, easing: "inQuad" }
      ]
    });
  }

  return tracks;
}

export function composeSceneTimeline({ intent, styleName, layout, seed, beats }) {
  validateIntent(intent);
  validateLayout(layout);

  const preset = getPreset(styleName);
  const rng = seededRandom(seed);

  const sceneDurationMs = intent.durationMs;
  const sceneId = intent.id || `scene-${seed}`;

  const layers = [];
  let currentDelay = 0;
  const usedAccents = new Set();
  const elementEnterEnds = [];
  const bodyAccentIds = (intent.elements || [])
    .filter(e => e.kind === "body")
    .map(e => `body-accent-${e.id}`);

  for (let i = 0; i < (intent.elements || []).length; i++) {
    const element = intent.elements[i];
    const { tracks, enterEndMs } = buildElementTracks(
      element, preset, layout, rng, beats, 0, i, sceneDurationMs
    );
    elementEnterEnds.push({ element, enterEndMs });

    layers.push({
      id: element.id,
      depth: element.depth ?? 1.0,
      tracks
    });

    currentDelay = Math.max(currentDelay, enterEndMs);
  }

  const tOut = intent.transitionOut || { kind: "none", durationMs: 0 };
  const holdStartMs = currentDelay;
  const holdEndMs = sceneDurationMs - tOut.durationMs;

  for (let i = 0; i < elementEnterEnds.length; i++) {
    const { element, enterEndMs } = elementEnterEnds[i];
    const accentTracks = buildAccentTracks(
      element, element.kind, enterEndMs, holdStartMs, holdEndMs, usedAccents, bodyAccentIds
    );
    if (accentTracks.length > 0) {
      const layer = layers[i];
      layer.tracks.push(...accentTracks);
    }
  }

  if (intent.camera) {
    const camTracks = buildCameraTracks(intent.camera, preset, layout, rng, sceneDurationMs);
    if (camTracks.length > 0) {
      layers.push({
        id: "__camera",
        depth: 0,
        tracks: camTracks
      });
    }
  }

  if (intent.backdrop !== false) {
    const factor = preset.backdropFactor;
    const camTracks = buildCameraTracks(
      intent.camera || { move: "push-in" },
      preset, layout, rng, sceneDurationMs
    );
    const backdropTracks = camTracks.map(t => ({
      ...t,
      keys: t.keys.map(k => ({
        ...k,
        value: t.property === "scale"
          ? 1 + (k.value - 1) * factor
          : k.value * factor
      }))
    }));
    backdropTracks.push({
      property: "opacity",
      repeat: "loop",
      phaseMs: 0,
      keys: [
        { tMs: 0, value: 1 },
        { tMs: 3400, value: 0.35, easing: "inOutQuad" },
        { tMs: 6800, value: 1, easing: "inOutQuad" }
      ]
    });
    layers.push({
      id: "backdrop",
      depth: 0.2,
      tracks: backdropTracks
    });
  }

  if (intent.glow !== false) {
    const factor = preset.glowFactor;
    const camTracks = buildCameraTracks(
      intent.camera || { move: "push-in" },
      preset, layout, rng, sceneDurationMs
    );
    const glowTracks = camTracks.map(t => ({
      ...t,
      keys: t.keys.map(k => ({
        ...k,
        value: t.property === "scale"
          ? 1 + (k.value - 1) * factor
          : k.value * factor
      }))
    }));
    glowTracks.push({
      property: "translateX",
      repeat: "loop",
      phaseMs: 0,
      keys: [
        { tMs: 0, value: 0 },
        { tMs: 4500, value: 23, easing: "inOutQuad" },
        { tMs: 9000, value: 0, easing: "inOutQuad" }
      ]
    });
    glowTracks.push({
      property: "translateY",
      repeat: "loop",
      phaseMs: -4000,
      keys: [
        { tMs: 0, value: 0 },
        { tMs: 5500, value: 21, easing: "inOutQuad" },
        { tMs: 11000, value: 0, easing: "inOutQuad" }
      ]
    });
    layers.push({
      id: "glow",
      depth: 0.6,
      tracks: glowTracks
    });
  }

  const transitionTracks = buildTransitionTracks(
    { durationMs: sceneDurationMs, transitionIn: intent.transitionIn, transitionOut: intent.transitionOut },
    preset
  );
  if (transitionTracks.length > 0) {
    layers.push({
      id: "__scene",
      depth: 1,
      tracks: transitionTracks
    });
  }

  return {
    version: 1,
    durationMs: sceneDurationMs,
    fps: intent.fps || 60,
    width: layout.width,
    height: layout.height,
    seed,
    style: styleName,
    scenes: [
      {
        id: sceneId,
        startMs: 0,
        durationMs: sceneDurationMs,
        role: intent.role || "body",
        transitionIn: intent.transitionIn || { kind: "none", durationMs: 0 },
        transitionOut: intent.transitionOut || { kind: "none", durationMs: 0 },
        camera: intent.camera || null,
        layers
      }
    ],
    beats: beats || []
  };
}

export { CAMERA_MOVES };
