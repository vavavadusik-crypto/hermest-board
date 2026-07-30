import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileTimelineCss } from "../src/animation/index.js";
import { CAT_LOOKS, CAT_VIEWBOX_HEIGHT, CAT_VIEWBOX_WIDTH, animalCastCss, renderCat } from "./animal-cast.js";
import { CHARACTER_VIEWBOX_HEIGHT, CHARACTER_VIEWBOX_WIDTH, cartoonCharacterCss, renderCharacter, renderForeground, renderSetting } from "./vendor/cartoon-cast.js";
import { DESK_TOP_Y, GROUND_Y, HEIGHT, sceneIntent, sceneTimeline, SETTING_CHARACTER_HEIGHT, WIDTH } from "./scene.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");

function removeKeyframes(css) {
  let output = "";
  let cursor = 0;
  let removed = 0;
  while (true) {
    const start = css.indexOf("@keyframes", cursor);
    if (start === -1) return { css: output + css.slice(cursor), removed };
    output += css.slice(cursor, start);
    const open = css.indexOf("{", start);
    if (open === -1) throw new Error("Malformed vendor CSS: @keyframes without opening brace");
    let depth = 1;
    let end = open + 1;
    for (; end < css.length && depth > 0; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}") depth -= 1;
    }
    if (depth !== 0) throw new Error("Malformed vendor CSS: unclosed @keyframes block");
    removed += 1;
    cursor = end;
  }
}

// Вендорная разметка хранит полезные transform-origin/transform-box и цвета,
// но её самостоятельные циклы конфликтуют с инлайновым выводом движка.
function staticCastCss() {
  const source = cartoonCharacterCss();
  const animationDeclarations = (source.match(/\banimation\s*:/g) || []).length;
  const { css: withoutKeyframes, removed: keyframes } = removeKeyframes(source);
  const css = withoutKeyframes.replace(/\s*animation\s*:\s*[^;}]+;?/g, "");
  if (/\banimation\s*:/i.test(css)) throw new Error("Vendor animation declaration survived CSS sanitization");
  return { css, animationDeclarations, keyframes };
}

// Нельзя полагаться на совпадение класса и layer id: движок ищет только
// data-layer-id. Проверка каждого обязательного класса предотвращает немую
// потерю конечности при изменении рига.
function decorateRig(svg, prefix, bindings) {
  const expected = new Map(Object.entries(bindings).map(([className, suffix]) => [className, { suffix, found: 0 }]));
  const decorated = svg.replace(/class="([^"]+)"/g, (whole, classList) => {
    const classes = classList.split(/\s+/);
    const className = classes.find(name => expected.has(name));
    if (!className) return whole;
    const entry = expected.get(className);
    entry.found += 1;
    const layerId = `${prefix}-${entry.suffix}`;
    return `class="${classList} layer-${layerId}" data-layer-id="${layerId}"`;
  });
  for (const [className, entry] of expected) {
    if (entry.found !== 1) {
      throw new Error(`Rig ${prefix}: expected exactly one .${className}, found ${entry.found}`);
    }
  }
  return { svg: decorated, nodeCount: [...expected.values()].reduce((total, entry) => total + entry.found, 0) };
}

function withoutInlineStyles(svg) {
  return svg.replace(/\sstyle="[^"]*"/g, "");
}

const HUMAN_BINDINGS = Object.freeze({
  "tc-face": "root", "tc": "puppet", "tc-arm-left": "arm-left", "tc-arm-right": "arm-right",
  "tc-fore-left": "fore-left", "tc-fore-right": "fore-right", "tc-leg-left": "leg-left", "tc-leg-right": "leg-right",
  "tc-body": "body", "tc-head": "head", "tc-eyes": "eyes", "tc-brow-left": "brow-left", "tc-brow-right": "brow-right",
  "tc-mouth": "mouth", "tc-mouth-closed": "mouth-closed", "tc-mouth-mid": "mouth-mid", "tc-mouth-open": "mouth-open"
});
const CAT_BINDINGS = Object.freeze({
  "ac-face": "root", "ac": "puppet", "ac-tail-1": "tail-1", "ac-tail-2": "tail-2", "ac-tail-3": "tail-3",
  "ac-body": "body", "ac-leg-bl": "leg-bl", "ac-leg-br": "leg-br", "ac-leg-fl": "leg-fl", "ac-leg-fr": "leg-fr",
  "ac-head": "head", "ac-ear-left": "ear-left", "ac-ear-right": "ear-right", "ac-eye-left": "eye-left", "ac-eye-right": "eye-right", "ac-muzzle": "muzzle"
});

function baseCss() {
  const { css: humanCss, animationDeclarations, keyframes } = staticCastCss();
  const settingMarkup = renderSetting({ setting: "desk", width: WIDTH, height: HEIGHT, groundY: GROUND_Y, characterHeight: SETTING_CHARACTER_HEIGHT, seed: 17 });
  const foregroundMarkup = renderForeground({ setting: "desk", width: WIDTH, height: HEIGHT, groundY: GROUND_Y, characterHeight: SETTING_CHARACTER_HEIGHT });
  const vanya = decorateRig(withoutInlineStyles(renderCharacter({ id: "vanya", name: "Ваня", pose: "idle", facing: "right", index: 0, look: { skin: "#eab68d", hairColor: "#221a14", hairStyle: "short", shirt: "#2dd4bf", trousers: "#1d2b45", build: "regular", accessory: "none" } })), "vanya", HUMAN_BINDINGS);
  const cat = decorateRig(renderCat({ look: CAT_LOOKS.ginger, facing: "left" }), "cat", CAT_BINDINGS);

  const css = `
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #081326; }
body { font-family: ui-rounded, "Trebuchet MS", system-ui, sans-serif; }
.stage { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; isolation: isolate; background: #081326; }
.camera-stage { position: absolute; inset: 0; transform-origin: ${WIDTH / 2}px ${HEIGHT / 2}px; }
.setting, .foreground, .actor { position: absolute; inset: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: visible; }
.setting { z-index: 1; } .actors { position: absolute; inset: 0; z-index: 2; } .foreground { z-index: 3; pointer-events: none; }
.vanya { position: absolute; left: 488px; top: 360px; width: 248px; height: 520px; overflow: visible; }
.cat { position: absolute; left: 1320px; top: 592px; width: 350px; height: 325px; overflow: visible; }
.cat .ac-face { transform-origin: 140px 230px; }
.speech { position: absolute; z-index: 4; left: 660px; top: 128px; width: 430px; padding: 25px 30px 27px; border: 4px solid #0a1120; border-radius: 38px; color: #0a1120; background: #f4f7ff; font-size: 35px; font-weight: 760; line-height: 1.14; letter-spacing: -.7px; box-shadow: 0 16px 0 rgba(10,17,32,.22); opacity: 0; }
.speech::after { content: ""; position: absolute; right: 54px; bottom: -28px; width: 42px; height: 42px; border-right: 4px solid #0a1120; border-bottom: 4px solid #0a1120; background: #f4f7ff; transform: rotate(45deg); }
.layer-speech { transform-origin: 50% 100%; }
${humanCss}
${animalCastCss()}
`;
  return { css, settingMarkup, foregroundMarkup, vanya, cat, animationDeclarations, keyframes };
}

const built = baseCss();
const sceneMarkup = `<main id="scene" class="stage" aria-label="Ночной офис: Ваня и кот на столе">
  <div class="camera-stage layer-camera-stage" data-layer-id="camera-stage">
    <svg class="setting" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">${built.settingMarkup}</svg>
    <div class="actors">
      <svg class="actor vanya" viewBox="0 0 ${CHARACTER_VIEWBOX_WIDTH} ${CHARACTER_VIEWBOX_HEIGHT}" role="img" aria-label="Ваня печатает">${built.vanya.svg}</svg>
      <svg class="actor cat" viewBox="0 0 ${CAT_VIEWBOX_WIDTH} ${CAT_VIEWBOX_HEIGHT}" role="img" aria-label="Кот идёт к столу">${built.cat.svg}</svg>
    </div>
    <svg class="foreground" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">${built.foregroundMarkup}</svg>
    <aside class="speech layer-speech" data-layer-id="speech">Он опять сел<br>на пробел.</aside>
  </div>
</main>`;

const compiledCss = compileTimelineCss(sceneTimeline);
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=1920, initial-scale=1"><title>Ваня, кот и пробел</title><style>${built.css}\n${compiledCss}</style></head><body>${sceneMarkup}</body></html>\n`;
const seekHtml = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=1920, initial-scale=1"><title>Ваня, кот и пробел — seek</title><style>${built.css}</style></head><body>${sceneMarkup}<script type="module">
import { createTimelineRenderer } from "../src/animation/index.js";
const timeline = ${JSON.stringify(sceneTimeline)};
try {
  const renderer = createTimelineRenderer(document.querySelector("#scene"), timeline);
  window.__seek = ms => renderer.seek(ms);
  window.__seek(0);
  window.__ready = true;
} catch (error) {
  window.__bootError = error?.stack || String(error);
  throw error;
}
</script></body></html>\n`;

if (/<script\b/i.test(html)) throw new Error("scene.html must not contain script tags");
const vendorAnimationsInOutput = (built.css.match(/\banimation\s*:/g) || []).length;
if (vendorAnimationsInOutput !== 0) throw new Error("Vendor animation declaration leaked into static CSS");
if (DESK_TOP_Y !== 700) throw new Error(`Unexpected desk top: ${DESK_TOP_Y}`);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "scene.html"), html, "utf8");
await writeFile(path.join(here, "seek-scene.html"), seekHtml, "utf8");
await writeFile(path.join(outDir, "scene-timeline.json"), JSON.stringify({ intent: sceneIntent, timeline: sceneTimeline }, null, 2) + "\n", "utf8");
console.log(`Built demo-cartoon/out/scene.html and demo-cartoon/seek-scene.html (14.000 s, ${built.vanya.nodeCount + built.cat.nodeCount} rig nodes).`);
console.log(`Desk top Y: ${DESK_TOP_Y}px = groundY ${GROUND_Y}px - characterHeight ${SETTING_CHARACTER_HEIGHT}px × 0.45.`);
console.log(`Disabled ${built.animationDeclarations} vendor animation declarations and removed ${built.keyframes} vendor keyframes.`);
