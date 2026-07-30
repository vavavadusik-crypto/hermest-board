/**
 * Привязка к DOM: createTimelineRenderer.
 * seek(timeMs) пишет инлайновые стили.
 * Идемпотентен, не зависит от порядка вызовов.
 */

import { evaluateTimeline } from "./timeline.js";

export function createTimelineRenderer(rootElement, timeline) {
  if (!rootElement || !rootElement.nodeType) {
    throw new TypeError("rootElement must be a DOM element");
  }

  const elementCache = new Map();

  function getLayerElement(layerId) {
    if (elementCache.has(layerId)) {
      return elementCache.get(layerId);
    }
    const el = rootElement.querySelector(`[data-layer-id="${layerId}"], #${layerId}`);
    if (el) {
      elementCache.set(layerId, el);
    }
    return el || null;
  }

  function clearStyles() {
    for (const [, el] of elementCache) {
      if (el && el.style) {
        el.style.cssText = "";
      }
    }
  }

  function seek(timeMs) {
    const frame = evaluateTimeline(timeline, timeMs);

    const activeIds = new Set(Object.keys(frame.layers));
    for (const [layerId, el] of elementCache) {
      if (!activeIds.has(layerId) && el && el.style) {
        el.style.cssText = "";
      }
    }

    for (const [layerId, styles] of Object.entries(frame.layers)) {
      const el = getLayerElement(layerId);
      if (!el || !el.style) continue;

      const cssParts = [];
      for (const [prop, val] of Object.entries(styles)) {
        cssParts.push(`${prop}: ${val}`);
      }
      el.style.cssText = cssParts.join("; ");
    }

    if (frame.values) {
      for (const [layerId, val] of Object.entries(frame.values)) {
        const el = getLayerElement(layerId);
        if (!el) continue;
        const layer = findLayer(timeline, layerId);
        let formatted = String(val);
        if (layer) {
          const numTrack = (layer.tracks || []).find(t => t.property === "numberValue");
          if (numTrack) {
            const decimals = numTrack.decimals ?? 0;
            const thousands = numTrack.thousands ?? " ";
            const prefix = numTrack.prefix ?? "";
            const suffix = numTrack.suffix ?? "";
            const fixed = val.toFixed(decimals);
            const parts = fixed.split(".");
            const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
            const fracPart = parts[1] ? "." + parts[1] : "";
            formatted = prefix + intPart + fracPart + suffix;
          }
        }
        el.textContent = formatted;
      }
    }

    return frame;
  }

  function dispose() {
    clearStyles();
    elementCache.clear();
  }

  return { seek, dispose };
}

function findLayer(timeline, layerId) {
  for (const scene of timeline.scenes || []) {
    for (const layer of scene.layers || []) {
      if (layer.id === layerId) return layer;
    }
  }
  return null;
}
