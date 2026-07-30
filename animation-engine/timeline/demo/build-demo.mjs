import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { THEME, compileTimelineCss, composeSceneTimeline } from "../src/animation/index.js";
import { layout, scenes, seed } from "./scenes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");

function scopeTimeline(timeline, key) {
  const scene = timeline.scenes[0];
  return {
    ...timeline,
    scenes: [{
      ...scene,
      layers: scene.layers.map(layer => ({ ...layer, id: `${key}-${layer.id.replace(/^__/, "")}` }))
    }]
  };
}

function buildTimelines() {
  let startMs = 0;
  const entries = scenes.map((scene, index) => {
    const rawTimeline = composeSceneTimeline({
      intent: scene.intent,
      styleName: scene.styleName,
      layout,
      seed: seed + index,
      beats: []
    });
    const timeline = scopeTimeline(rawTimeline, scene.key);
    const entry = { ...scene, startMs, rawTimeline, timeline };
    if (index < scenes.length - 1) {
      startMs += scene.intent.durationMs - (scene.intent.transitionOut?.durationMs || 0);
    }
    return entry;
  });
  const totalMs = entries.at(-1).startMs + entries.at(-1).intent.durationMs;
  const combinedTimeline = {
    version: 1,
    durationMs: totalMs,
    fps: 30,
    width: layout.width,
    height: layout.height,
    seed,
    style: "demo",
    beats: [],
    scenes: entries.map(entry => ({ ...entry.timeline.scenes[0], startMs: entry.startMs }))
  };
  return { entries, combinedTimeline, totalMs };
}

function shiftAnimationDelays(css, offsetMs) {
  if (offsetMs === 0) return css;
  return css.replace(
    /(\b\d+(?:\.\d+)?s\s+(?:linear|ease(?:-[\w-]+)?|cubic-bezier\([^)]*\))\s+)(-?\d+(?:\.\d+)?s)/g,
    (_match, prefix, delay) => `${prefix}${(Number.parseFloat(delay) + offsetMs / 1000).toFixed(3)}s`
  );
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function layer(key, id, className, content = "") {
  const scoped = `${key}-${id}`;
  return `<div class="${className} layer-${scoped}" data-layer-id="${scoped}">${content}</div>`;
}

function boardMarkup(intent) {
  const cards = intent.elements.filter(element => element.kind === "panel");
  const slots = ["north-west", "north-east", "south-west", "south-east"];
  return `<aside class="board" aria-label="Макет Hermest Board">
      <div class="board-heading"><span class="board-dot"></span>HERMEST BOARD <span class="board-status">LIVE</span></div>
      <svg class="board-links" viewBox="0 0 700 650" aria-hidden="true" preserveAspectRatio="none">
        <path d="M 302 166 C 333 166, 353 230, 382 238" />
        <path d="M 512 332 C 483 360, 402 396, 344 428" />
        <path d="M 344 492 C 391 508, 430 528, 462 550" />
      </svg>
      ${cards.map((card, index) => layer(intent.id, card.id, `board-card ${slots[index]}`, `<h3>${esc(card.text)}</h3><p>${esc(card.lines?.[0] || "")}</p><p>${esc(card.lines?.[1] || "")}</p>`)).join("\n      ")}
    </aside>`;
}

function actMarkup(scene, index, cssCounter = false) {
  const { key, label, intent } = scene;
  const elements = intent.elements.filter(element => element.kind !== "panel").map(element => {
    const classes = `copy ${element.kind}`;
    const text = element.kind === "number" && cssCounter ? "<span class=\"fps-display\">0 fps</span>" : element.kind === "number" ? `0${esc(element.suffix || "")}` : esc(element.text);
    return layer(key, element.id, classes, text);
  }).join("\n      ");
  return `<section class="act ${key} layer-${key}-scene" data-layer-id="${key}-scene" style="--act-index: ${index + 1}">
    ${layer(key, "camera", "camera", `<div class="camera-grid"></div>`)}
    ${layer(key, "backdrop", "backdrop")}
    ${layer(key, "glow", "glow")}
    <div class="content">
      ${elements}
    </div>
    ${boardMarkup(intent)}
    <div class="preset-label">${esc(label)}</div>
  </section>`;
}

function baseCss() {
  return `
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: ${THEME.background}; }
body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ${THEME.text}; }
.stage { position: relative; width: 1920px; height: 1080px; overflow: hidden; isolation: isolate; background: ${THEME.background}; }
.act, .camera, .backdrop, .glow { position: absolute; inset: 0; }
.act { z-index: var(--act-index); opacity: 0; overflow: hidden; pointer-events: none; }
.camera { inset: -72px; background: radial-gradient(circle at 72% 18%, rgba(124, 92, 255, .28), transparent 28%), radial-gradient(circle at 10% 92%, rgba(45, 212, 191, .18), transparent 35%), linear-gradient(135deg, #071225 0%, ${THEME.background} 50%, #10142d 100%); transform-origin: 50% 46%; }
.camera-grid { position: absolute; inset: 0; opacity: .4; background-image: linear-gradient(rgba(143, 163, 200, .06) 1px, transparent 1px), linear-gradient(90deg, rgba(143, 163, 200, .06) 1px, transparent 1px); background-size: 96px 96px; mask-image: radial-gradient(circle at 58% 40%, black, transparent 73%); }
.backdrop { left: 120px; right: auto; top: 142px; bottom: auto; width: 750px; border: 1px solid rgba(45, 212, 191, .22); border-radius: 40px; background: linear-gradient(145deg, rgba(45, 212, 191, .12), rgba(124, 92, 255, .04)); box-shadow: 0 32px 100px rgba(0, 0, 0, .35); }
.act1 .backdrop { height: 410px; }
.act2 .backdrop { height: 585px; }
.act3 .backdrop { height: 665px; }
.glow { left: auto; top: 120px; right: 160px; bottom: auto; width: 520px; height: 520px; border-radius: 50%; filter: blur(20px); background: radial-gradient(circle, rgba(124, 92, 255, .24), transparent 67%); }
.content { position: absolute; z-index: 3; left: 150px; top: 182px; width: 700px; }
.copy { position: relative; width: fit-content; max-width: 700px; text-wrap: balance; }
.kicker { margin-bottom: 34px; color: ${THEME.accent}; font-size: 20px; font-weight: 740; letter-spacing: 4px; line-height: 1.2; }
.headline { margin-top: 0; color: ${THEME.text}; font-size: 78px; font-weight: 740; line-height: 1.02; letter-spacing: -3.2px; }
.lead { margin-top: 42px; max-width: 690px; color: ${THEME.textMuted}; font-size: 34px; font-weight: 460; line-height: 1.18; letter-spacing: -.8px; }
.body { margin-top: 24px; padding-left: 31px; color: ${THEME.text}; font-size: 27px; line-height: 1.18; font-weight: 500; }
.body::before { content: ""; position: absolute; left: 0; top: .42em; width: 11px; height: 11px; border-radius: 50%; background: ${THEME.accentWarm}; box-shadow: 0 0 24px rgba(245, 185, 68, .8); }
.number { margin-top: -18px; color: ${THEME.accentWarm}; font-size: 196px; line-height: .95; font-weight: 760; letter-spacing: -11px; text-shadow: 0 12px 45px rgba(245, 185, 68, .16); }
.act3 .lead { max-width: 680px; margin-top: 38px; }
.act3 .headline { margin-top: 36px; font-size: 72px; }
.board { position: absolute; z-index: 4; top: 154px; right: 125px; width: 700px; height: 650px; }
.board-heading { position: absolute; top: 0; left: 0; color: ${THEME.textMuted}; font-size: 17px; font-weight: 720; letter-spacing: 2px; line-height: 1; }
.board-dot { display: inline-block; width: 9px; height: 9px; margin: 0 10px 1px 0; border-radius: 50%; background: ${THEME.accent}; box-shadow: 0 0 16px rgba(45, 212, 191, .8); }
.board-status { margin-left: 12px; color: ${THEME.accent}; font-size: 12px; letter-spacing: 1.4px; }
.board-links { position: absolute; top: 0; left: 0; width: 700px; height: 650px; overflow: visible; }
.board-links path { fill: none; stroke: rgba(143, 163, 200, .42); stroke-width: 1.4; stroke-linecap: round; }
.board-card { position: absolute; z-index: 1; width: 304px; min-height: 145px; padding: 21px 23px 18px; overflow: hidden; border: 1px solid rgba(143, 163, 200, .3); border-radius: 22px; background: linear-gradient(145deg, rgba(18, 35, 61, .94), rgba(9, 18, 34, .86)); box-shadow: 0 18px 42px rgba(0, 0, 0, .27); }
.board-card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: linear-gradient(${THEME.accent}, ${THEME.accentAlt}); opacity: .82; }
.board-card h3 { position: relative; margin: 0 0 16px; color: ${THEME.text}; font-size: 22px; font-weight: 650; letter-spacing: -.45px; line-height: 1.1; }
.board-card p { position: relative; width: 76%; height: 8px; margin: 10px 0 0; overflow: hidden; color: transparent; border-radius: 999px; background: linear-gradient(90deg, rgba(143, 163, 200, .48), rgba(143, 163, 200, .16)); font-size: 1px; }
.board-card p::after { content: attr(data-label); }
.north-west { top: 92px; left: 0; }
.north-east { top: 164px; right: 0; }
.south-west { top: 354px; left: 52px; }
.south-east { top: 462px; right: 42px; width: 270px; }
.preset-label { position: absolute; z-index: 5; left: 150px; bottom: 76px; border: 1px solid ${THEME.panelBorder}; border-radius: 999px; padding: 13px 19px; color: ${THEME.textMuted}; background: ${THEME.captionBar}; font-size: 19px; line-height: 1; letter-spacing: .2px; }
@property --fps { syntax: "<integer>"; inherits: false; initial-value: 0; }
@keyframes fps-counter { 0% { --fps: 0; } 100% { --fps: 60; } }
.css-demo .act3 .fps-display { --fps: 0; animation: 1.2s steps(60, end) .35s 1 both fps-counter; }
.css-demo .act3 .fps-display::after { content: counter(fps) " fps"; counter-reset: fps var(--fps); }
.css-demo .act3 .fps-display { color: transparent; }
.css-demo .act3 .fps-display::after { color: ${THEME.accentWarm}; }
`;
}

const { entries, combinedTimeline, totalMs } = buildTimelines();
const seekTimelineEntries = entries.map(entry => ({
  key: entry.key,
  startMs: entry.startMs,
  durationMs: entry.intent.durationMs,
  transitionInMs: entry.intent.transitionIn?.durationMs || 0,
  transitionOutMs: entry.intent.transitionOut?.durationMs || 0,
  timeline: entry.timeline
}));
const compiledCss = entries.map(entry => shiftAnimationDelays(
  compileTimelineCss(entry.timeline), entry.startMs
)).join("\n");
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, initial-scale=1">
<title>Hermest Animation Engine — CSS demo</title>
<style>${baseCss()}\n${compiledCss}</style>
</head>
<body><main class="stage css-demo" aria-label="Hermest Animation Engine demo">
${entries.map((entry, index) => actMarkup(entry, index, true)).join("\n")}
</main></body>
</html>`;
const seekHtml = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, initial-scale=1">
<title>Hermest Animation Engine — seek renderer</title>
<style>${baseCss()}</style>
</head>
<body><main id="demo" class="stage" aria-label="Hermest Animation Engine seek demo">
${entries.map((entry, index) => actMarkup(entry, index)).join("\n")}
</main><script type="module">
import { createTimelineRenderer } from "../src/animation/index.js";
const entries = ${JSON.stringify(seekTimelineEntries)};
try {
  const renderers = entries.map(entry => ({
    ...entry,
    element: document.querySelector("[data-layer-id='" + entry.key + "-scene']"),
    renderer: createTimelineRenderer(document.querySelector("#demo"), entry.timeline)
  }));
  window.__seek = ms => {
    for (const entry of renderers) {
      const localMs = ms - entry.startMs;
      const active = localMs >= 0 && localMs <= entry.durationMs;
      entry.element.style.visibility = active ? "visible" : "hidden";
      if (active) {
        entry.renderer.seek(localMs);
        const inOpacity = entry.transitionInMs ? Math.min(1, localMs / entry.transitionInMs) : 1;
        const outOpacity = entry.transitionOutMs ? Math.min(1, (entry.durationMs - localMs) / entry.transitionOutMs) : 1;
        entry.element.style.opacity = String(Math.max(0, Math.min(inOpacity, outOpacity)));
      }
      else entry.element.style.opacity = "0";
    }
  };
  window.__seek(0);
  window.__ready = true;
} catch (error) {
  window.__bootError = error?.stack || String(error);
  throw error;
}
</script></body>
</html>`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "demo.html"), html, "utf8");
await writeFile(path.join(here, "seek.html"), seekHtml, "utf8");
await writeFile(path.join(outDir, "timeline.json"), JSON.stringify({
  layout, seed, timelines: entries.map(entry => entry.timeline), combinedTimeline
}, null, 2) + "\n", "utf8");
console.log(`Built demo/out/demo.html and demo/out/timeline.json (${totalMs} ms, ${entries.length} acts).`);
