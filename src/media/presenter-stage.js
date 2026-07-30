import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { THEME, clampText, escapeHtml } from "./scene-design.js";

export const PRESENTER_ANGLES = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ASSETS_ROOT = path.join(ROOT, "assets", "presenters");
const MOVE_MS = 520;
const LINK_MS = 200;
const WINDOW_MS = 260;
const HARD_CUT_MS = 1;

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

function assertAtlas(atlas) {
  if (!atlas || typeof atlas !== "object" || !Array.isArray(atlas.frames) || !atlas.frames.length) {
    throw new TypeError("Presenter atlas requires a non-empty frames list");
  }
  if (!(Number(atlas.frameWidth) > 0) || !(Number(atlas.frameHeight) > 0)) {
    throw new TypeError("Presenter atlas requires positive frameWidth and frameHeight");
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
  for (const angle of PRESENTER_ANGLES) {
    const frame = closestAtlasFrame(atlas, angle);
    const framePath = path.resolve(root, frame.file);
    if (!framePath.startsWith(root + path.sep) || !existsSync(framePath)) {
      throw new Error('Presenter atlas for "' + safeId + '" is missing the ' + angle + ' degree frame (' + frame.file + ')');
    }
  }
  return { ...atlas, root };
}

function stageGeometry(frameWidth, frameHeight, atlas) {
  const height = Math.round(clamp(frameHeight * 0.52, 160, frameHeight * 0.64));
  const width = Math.round(height * Number(atlas.frameWidth) / Number(atlas.frameHeight));
  const bottom = Math.round(clamp(frameHeight * 0.035, 8, 42));
  return { width, height, top: frameHeight - bottom - height };
}

function windowGeometry(raw, frameWidth, frameHeight) {
  const maxWidth = Math.floor(frameWidth * 0.34);
  const width = Math.max(1, Math.min(maxWidth, Math.round(frameWidth * 0.3)));
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

export function buildPresenterTimeline({ beats, frameWidth, frameHeight, atlas, startX = 0.5, durationMs } = {}) {
  const width = Number(frameWidth);
  const height = Number(frameHeight);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError("Presenter stage requires positive integer frame dimensions");
  }
  assertAtlas(atlas);
  const usable = (Array.isArray(beats) ? beats : [])
    .filter(beat => beat && typeof beat === "object" && beat.window && typeof beat.window === "object")
    .map((beat, index) => ({ ...beat, index, atMs: asMs(beat.atMs) }))
    .sort((left, right) => left.atMs - right.atMs || left.index - right.index);
  const duration = Math.max(asMs(durationMs), (usable.at(-1)?.atMs ?? 0) + MOVE_MS + LINK_MS + WINDOW_MS, 1000);
  const presenter = stageGeometry(width, height, atlas);
  const minCenterX = presenter.width / 2;
  const maxCenterX = width - presenter.width / 2;
  const initialCenterX = clamp(asFraction(startX, 0.5) * width, minCenterX, maxCenterX);
  let previousCenterX = initialCenterX;
  const planned = usable.map(beat => {
    const centerX = clamp(asFraction(beat.moveTo, previousCenterX / width) * width, minCenterX, maxCenterX);
    const window = windowGeometry(beat.window, width, height);
    const center = { x: Math.round(centerX), y: Math.round(presenter.top + presenter.height / 2) };
    const angle = nearestPresenterAngle(calculatePresenterAngle({ presenterCenter: center, windowCenter: window.center }));
    const hand = { x: center.x, y: Math.round(presenter.top + presenter.height * 0.56) };
    const edge = { x: clamp(hand.x, window.x, window.x + window.width), y: clamp(hand.y, window.y, window.y + window.height) };
    previousCenterX = centerX;
    return {
      ...beat, centerX: Math.round(centerX), angle, window, hand, edge, link: lineBox(hand, edge),
      moveEndMs: Math.min(duration, beat.atMs + MOVE_MS),
      linkStartMs: Math.min(duration, beat.atMs + MOVE_MS),
      linkEndMs: Math.min(duration, beat.atMs + MOVE_MS + LINK_MS),
      windowStartMs: Math.min(duration, beat.atMs + MOVE_MS + LINK_MS),
      windowEndMs: Math.min(duration, beat.atMs + MOVE_MS + LINK_MS + WINDOW_MS)
    };
  });
  const initialAngle = planned[0]?.angle ?? 0;
  const layers = {
    presenter: { translateX: [key(0, Math.round(initialCenterX - presenter.width / 2))], translateY: [key(0, 0)] },
    "presenter-breath": { scaleY: [key(0, 1), key(2000, 1.006), key(4000, 1)] }
  };
  for (const angle of PRESENTER_ANGLES) layers["presenter-a" + angle] = { opacity: [key(0, angle === initialAngle ? 1 : 0)] };
  let facing = initialAngle;
  let fromCenterX = initialCenterX;
  const hardCuts = [];
  for (const beat of planned) {
    push(layers.presenter.translateX, beat.atMs, Math.round(fromCenterX - presenter.width / 2));
    push(layers.presenter.translateX, beat.moveEndMs, Math.round(beat.centerX - presenter.width / 2), "inOutCubic");
    push(layers.presenter.translateY, beat.atMs, 0);
    push(layers.presenter.translateY, Math.min(beat.moveEndMs, beat.atMs + 250), -6, "inOutCubic");
    push(layers.presenter.translateY, beat.moveEndMs, 0, "inOutCubic");
    if (beat.angle !== facing) {
      const endMs = Math.min(duration, beat.atMs + HARD_CUT_MS);
      push(layers["presenter-a" + facing].opacity, beat.atMs, 1);
      push(layers["presenter-a" + facing].opacity, endMs, 0);
      push(layers["presenter-a" + beat.angle].opacity, beat.atMs, 0);
      push(layers["presenter-a" + beat.angle].opacity, endMs, 1);
      hardCuts.push({ from: facing, to: beat.angle, atMs: beat.atMs, endMs });
      facing = beat.angle;
    }
    layers["link-" + (beat.index + 1)] = { clipReveal: [key(0, 0), key(beat.linkStartMs, 0), key(beat.linkEndMs, 1, "inOutCubic")] };
    layers["window-" + (beat.index + 1)] = {
      opacity: [key(0, 0), key(beat.windowStartMs, 0), key(beat.windowEndMs, 1, "inOutCubic")],
      scale: [key(0, 0.94), key(beat.windowStartMs, 0.94), key(beat.windowEndMs, 1, "inOutCubic")],
      clipReveal: [key(0, 0), key(beat.windowStartMs, 0), key(beat.windowEndMs, 1, "inOutCubic")]
    };
    fromCenterX = beat.centerX;
  }
  for (const layer of Object.values(layers)) for (const track of Object.values(layer)) {
    track.sort((left, right) => left.atMs - right.atMs);
    if (track.at(-1).atMs < duration) push(track, duration, track.at(-1).value);
  }
  return { durationMs: duration, frame: { width, height }, presenter: { ...presenter, minCenterX, maxCenterX }, beats: planned, layers, hardCuts };
}

export function evaluatePresenterOpacity(timeline, atMs) {
  const time = clamp(Number(atMs) || 0, 0, timeline.durationMs);
  return Object.fromEntries(PRESENTER_ANGLES.map(angle => {
    const track = timeline.layers["presenter-a" + angle].opacity;
    let previous = track[0];
    let next = null;
    for (const point of track) {
      if (point.atMs <= time) previous = point;
      if (point.atMs > time) { next = point; break; }
    }
    const value = next ? previous.value + (next.value - previous.value) * (time - previous.atMs) / (next.atMs - previous.atMs) : previous.value;
    return ["presenter-a" + angle, value];
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

export function renderPresenterMarkup({ timeline, atlas, beats, originX = 0, originY = 0 } = {}) {
  assertAtlas(atlas);
  if (!timeline?.layers) throw new TypeError("Presenter markup requires a timeline");
  const root = atlas.root || "";
  const images = PRESENTER_ANGLES.map(angle => {
    const frame = closestAtlasFrame(atlas, angle);
    const source = root ? pathToFileURL(path.resolve(root, frame.file)).href : frame.file;
    return '<img data-layer-id="presenter-a' + angle + '" alt="" src="' + escapeHtml(source) + '">';
  }).join("");
  const windows = timeline.beats.map(beat => {
    const index = beat.index + 1;
    const raw = beats?.[beat.index]?.window ?? beat.window ?? {};
    const title = clampText(raw.title, 56);
    const lines = Array.isArray(raw.lines) ? raw.lines.slice(0, 5).map(line => clampText(line, 72)).filter(Boolean) : [];
    return '<svg class="presenter-link" data-layer-id="link-' + index + '" aria-hidden="true" style="left:' + beat.link.x + 'px;top:' + beat.link.y + 'px;width:' + beat.link.width + 'px;height:' + beat.link.height + 'px" viewBox="0 0 ' + beat.link.width + ' ' + beat.link.height + '"><line x1="' + beat.link.from.x + '" y1="' + beat.link.from.y + '" x2="' + beat.link.to.x + '" y2="' + beat.link.to.y + '"></line></svg>' +
      '<section class="presenter-window" data-layer-id="window-' + index + '" style="left:' + beat.window.x + 'px;top:' + beat.window.y + 'px;width:' + beat.window.width + 'px;height:' + beat.window.height + 'px"><div class="presenter-window-bar"><span></span><span></span><span></span><b>HERMEST BOARD</b></div>' +
      (title ? '<h2>' + escapeHtml(title) + '</h2>' : "") + '<ul>' + lines.map(line => '<li>' + escapeHtml(line) + '</li>').join("") + '</ul></section>';
  }).join("");
  return '<div class="presenter-stage" style="left:' + Number(originX) + 'px;top:' + Number(originY) + 'px;width:' + timeline.frame.width + 'px;height:' + timeline.frame.height + 'px"><div class="presenter" data-layer-id="presenter" style="top:' + timeline.presenter.top + 'px;width:' + timeline.presenter.width + 'px;height:' + timeline.presenter.height + 'px"><div class="presenter-breath" data-layer-id="presenter-breath">' + images + '</div></div>' + windows + '</div>';
}

export function presenterStageCss({ timeline } = {}) {
  if (!timeline?.layers) throw new TypeError("Presenter CSS requires a timeline");
  const duration = timeline.durationMs;
  const finalX = latest(timeline.layers.presenter.translateX, duration);
  const finalY = latest(timeline.layers.presenter.translateY, duration);
  const times = [...new Set([...timeline.layers.presenter.translateX, ...timeline.layers.presenter.translateY].map(point => point.atMs))].sort((a, b) => a - b);
  const move = times.map(atMs => ({ atMs, value: { x: latest(timeline.layers.presenter.translateX, atMs), y: latest(timeline.layers.presenter.translateY, atMs) } }));
  const css = [
    ".presenter-stage { position:absolute; overflow:hidden; pointer-events:none; }",
    ".presenter { position:absolute; left:0; transform:translateX(" + finalX + "px) translateY(" + finalY + "px); transform-origin:50% 100%; animation:presenter-stage-move " + duration + "ms linear both; }",
    ".presenter-breath { position:absolute; inset:0; transform-origin:50% 100%; animation:presenter-stage-breath 4000ms ease-in-out infinite; }",
    ".presenter-breath img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }",
    ".presenter-link { position:absolute; overflow:visible; fill:none; stroke:" + THEME.accentWarm + ";stroke-width:2;stroke-linecap:round; }",
    ".presenter-window { position:absolute; box-sizing:border-box; overflow:hidden; border:1px solid rgba(95,136,196,.76); border-radius:12px; background:rgba(8,18,35,.96); box-shadow:0 16px 36px rgba(1,6,14,.48); color:" + THEME.text + "; padding:12px 14px; transform-origin:50% 50%; }",
    ".presenter-window-bar { display:flex; align-items:center; gap:5px; color:" + THEME.textMuted + "; font-size:9px; letter-spacing:1.2px; } .presenter-window-bar span { width:6px; height:6px; border-radius:50%; background:" + THEME.accentAlt + "; } .presenter-window-bar span:nth-child(2) { background:" + THEME.accentWarm + "; } .presenter-window-bar span:nth-child(3) { background:" + THEME.accent + "; } .presenter-window-bar b { margin-left:4px; font-size:9px; } .presenter-window h2 { margin:11px 0 7px; font-size:17px; line-height:1.08; } .presenter-window ul { margin:0; padding:0; list-style:none; } .presenter-window li { color:" + THEME.textMuted + "; font-size:13px; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
    cssKeyframes("presenter-stage-move", move, duration, value => "transform:translateX(" + value.x + "px) translateY(" + value.y + "px)"),
    "@keyframes presenter-stage-breath { 0%,100% { transform:scaleY(1); } 50% { transform:scaleY(1.006); } }"
  ];
  for (const angle of PRESENTER_ANGLES) {
    const id = "presenter-a" + angle;
    const finalOpacity = latest(timeline.layers[id].opacity, duration);
    css.push(cssKeyframes("presenter-stage-" + id, timeline.layers[id].opacity, duration, value => "opacity:" + value));
    css.push('.presenter-breath [data-layer-id="' + id + '"] { opacity:' + finalOpacity + "; animation:presenter-stage-" + id + " " + duration + "ms linear both; }");
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
