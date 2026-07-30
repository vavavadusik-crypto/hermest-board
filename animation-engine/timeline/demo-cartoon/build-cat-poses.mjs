import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { animalCastCss, CAT_LOOKS, CAT_VIEWBOX_HEIGHT, CAT_VIEWBOX_WIDTH, renderCat } from "./animal-cast.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");

const poses = [
  { label: "Спокойно", look: CAT_LOOKS.ginger, transforms: { "tail-1": "rotate(-8deg)", "tail-2": "rotate(9deg)", "tail-3": "rotate(-12deg)" } },
  { label: "Сидит", look: CAT_LOOKS.smoke, transforms: { body: "translateY(12px) scale(1.08, .86)", "leg-bl": "rotate(78deg)", "leg-br": "rotate(70deg)", "leg-fl": "rotate(-4deg)", "leg-fr": "rotate(4deg)", "tail-1": "rotate(-38deg)", "tail-2": "rotate(28deg)", "tail-3": "rotate(-12deg)", head: "rotate(-4deg)" } },
  { label: "Середина шага", look: CAT_LOOKS.ginger, transforms: { "leg-fl": "rotate(26deg)", "leg-br": "rotate(-26deg)", "leg-fr": "rotate(-14deg)", "leg-bl": "rotate(14deg)", "tail-1": "rotate(-20deg)", "tail-2": "rotate(17deg)", "tail-3": "rotate(-11deg)" } },
  { label: "Хвост трубой", look: CAT_LOOKS.midnight, transforms: { "tail-1": "rotate(99deg)", "tail-2": "rotate(22deg)", "tail-3": "rotate(46deg)", head: "rotate(5deg)" } },
  { label: "Моргнул", look: CAT_LOOKS.smoke, facing: "left", transforms: { "eye-left": "scaleY(.07)", "eye-right": "scaleY(.07)", "ear-right": "rotate(22deg)", "tail-1": "rotate(-13deg)", "tail-2": "rotate(12deg)", "tail-3": "rotate(-14deg)" } }
];

const cards = poses.map(({ label, look, facing, transforms }) => `<figure class="cat-card">
  <svg viewBox="0 0 ${CAT_VIEWBOX_WIDTH} ${CAT_VIEWBOX_HEIGHT}" role="img" aria-label="Кот: ${label}">${renderCat({ look, facing, transforms })}</svg>
  <figcaption>${label}</figcaption>
</figure>`).join("\n");

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=1920, initial-scale=1"><title>Кот — позы рига</title>
<style>
* { box-sizing: border-box; }
html, body { min-width: 1700px; min-height: 100%; margin: 0; background: #071225; }
body { color: #dce6f7; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.stage { min-height: 100vh; padding: 72px 58px 54px; background: #071225; }
h1 { margin: 0 0 14px; color: #f2f6ff; font-size: 34px; letter-spacing: -.8px; }
p { margin: 0 0 44px; color: #8fa3c8; font-size: 17px; }
.cats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px; align-items: end; }
.cat-card { min-width: 0; margin: 0; padding: 22px 12px 16px; border: 1px solid rgba(143,163,200,.25); border-radius: 22px; background: rgba(12,27,49,.72); text-align: center; box-shadow: 0 20px 48px rgba(0,0,0,.22); }
.cat-card svg { display: block; width: 100%; height: auto; max-height: 280px; margin: 0 auto; overflow: visible; }
figcaption { margin-top: 12px; color: #dce6f7; font-size: 18px; font-weight: 680; }
${animalCastCss()}
</style></head><body><main class="stage"><h1>Кот Hermest Board — проверка статичных поз</h1><p>Все повороты заданы инлайново на узлах рига; здесь нет CSS-движения.</p><section class="cats" aria-label="Пять статичных поз кота">${cards}</section></main></body></html>\n`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "cat-poses.html"), html, "utf8");
console.log(`Built demo-cartoon/out/cat-poses.html (${poses.length} poses; viewBox ${CAT_VIEWBOX_WIDTH}x${CAT_VIEWBOX_HEIGHT}).`);
