// `animation` — шорткат: два правила с равной специфичностью на одном элементе
// не складываются, второе затирает список целиком. Так уже погибло свечение
// стороны «после» в архетипе сравнения — правило доли шло позже и с тем же
// весом. Ошибка тихая: в CSS всё на месте, в кадре анимации нет.
//
// Проверка идёт по фактической разметке архетипа, а не по догадкам о каскаде:
// для каждого элемента собираются все правила с `animation`, которые к нему
// применимы. Больше одного — конфликт.

import assert from "node:assert/strict";
import test from "node:test";

import { renderSceneArchetype } from "../../src/media/scene-archetypes.js";
import { SCENE_ARCHETYPES, deriveSceneContent } from "../../src/media/scene-content.js";
import { resolveSceneLayout } from "../../src/media/scene-design.js";

// Контент собирается тем же деривером, что и в проде: собственные догадки о
// форме объекта разъезжаются с архетипами.
const CONTENT = deriveSceneContent({
  id: "scene-01",
  title: "Заголовок сцены",
  durationMs: 12000,
  text: "Первый пункт объяснения. Второй пункт объяснения. Третий пункт объяснения.",
  sceneData: {
    steps: ["Шаг первый", "Шаг второй", "Шаг третий"],
    items: ["Пункт один", "Пункт два", "Пункт три"],
    formats: ["16:9 — YouTube", "9:16 — Shorts", "1:1 — лента"],
    device: { kind: "laptop", title: "Окно", lines: ["строка один", "строка два"] },
    compare: {
      left: { label: "До", text: "Было тяжело", items: ["раз", "два"] },
      right: { label: "После", text: "Стало легче", items: ["раз", "два"] }
    },
    cartoon: {
      setting: "desk",
      cast: [{ id: "char-1", name: "Первый", pose: "talk", side: "left", speaking: true }],
      line: "Реплика героя.",
      caption: "Подпись"
    }
  }
});

// Каскад теряет анимацию только тогда, когда ПОЗДНЕЕ правило не перечислило
// то, что было в раннем: `animation` затирает список целиком. Правило, честно
// повторившее прежние имена и добавившее своё, ничего не теряет — так написан
// `.dg-node-active`, и ругаться на него было бы шумом.
//
// Разбор ограничен одиночными классами: именно селекторы такой формы и
// сталкиваются на одном элементе, составные (`.a .b`) адресуют другой.
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function animationNames(declaration, known) {
  return splitTopLevel(declaration)
    .map(segment => segment.trim().split(/\s+/u).find(token => known.has(token)) || "")
    .filter(Boolean);
}

function animatedClasses(css) {
  const known = new Set([...css.matchAll(/@keyframes\s+([a-z][a-z0-9-]*)/gu)].map(match => match[1]));
  const classes = new Map();
  let order = 0;
  for (const match of css.matchAll(/(^|[}])\s*([^{}]+)[{]([^{}]*)[}]/gu)) {
    const body = match[3];
    order += 1;
    const declaration = body.match(/(?:^|[;\s])animation\s*:\s*([^;]+)/u)?.[1];
    if (!declaration) continue;
    for (const selector of match[2].split(",")) {
      const single = selector.trim().match(/^\.([a-z][a-z0-9-]*)$/u);
      if (!single) continue;
      const rules = classes.get(single[1]) || [];
      rules.push({ order, names: animationNames(declaration, known) });
      classes.set(single[1], rules);
    }
  }
  return classes;
}

function elementClassSets(markup) {
  return [...markup.matchAll(/class="([^"]+)"/gu)].map(match => match[1].trim().split(/\s+/u));
}

const LAYOUTS = [
  { width: 1920, height: 1080, safeZones: { top: 54, right: 96, bottom: 54, left: 96 } },
  { width: 1080, height: 1920, safeZones: { top: 200, right: 96, bottom: 300, left: 96 } }
];

test("no element is given two competing animation declarations", () => {
  const conflicts = [];
  // Presenter needs a private customer atlas. Its animation contract is
  // covered by presenter-stage.test.mjs without requiring that asset here.
  for (const archetype of SCENE_ARCHETYPES.filter(archetype => archetype !== "presenter")) {
    for (const role of ["opening", "body", "closing"]) {
      for (const size of LAYOUTS) {
        const layout = resolveSceneLayout(size);
        const built = renderSceneArchetype({
          archetype, role, content: CONTENT, layout,
          topic: "тема ролика", sceneIndex: 1, sceneCount: 4,
          sceneTitles: ["Первая", "Вторая", "Третья", "Четвёртая"],
          heroFontSize: Math.round(layout.height / 14),
          durationMs: 12000
        });
        const animated = animatedClasses(built.css);
        for (const classes of elementClassSets(built.stage)) {
          const rules = classes
            .flatMap(name => (animated.get(name) || []).map(rule => ({ ...rule, name })))
            .sort((left, right) => left.order - right.order);
          if (rules.length < 2) continue;
          const winner = rules.at(-1);
          for (const loser of rules.slice(0, -1)) {
            const lost = loser.names.filter(name => !winner.names.includes(name));
            if (lost.length === 0) continue;
            conflicts.push(
              `${archetype}/${role}/${layout.width}x${layout.height}: .${winner.name} гасит ${lost.join(", ")} у .${loser.name}`
            );
          }
        }
      }
    }
  }
  assert.deepEqual(conflicts, [], `правила анимации затирают друг друга:\n${conflicts.join("\n")}`);
});
