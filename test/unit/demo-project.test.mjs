import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildDemoProject } from "../../src/ui/demo-project.js";

const SECRET_HINTS = /sk-|api[_-]?key|bearer|password|token|secret|elevenlabs|\.env/i;

test("demo project has the full pipeline shape a new user should see", () => {
  const doc = buildDemoProject({ visual: (kind, label) => `svg:${kind}:${label}`, schemaVersion: 4 });
  assert.equal(doc.schemaVersion, 4);
  assert.ok(doc.title.length > 0);
  assert.equal(doc.brief.language, "ru");
  assert.equal(doc.brief.generateVisuals, false, "demo must stay offline/deterministic by default");
  assert.ok(doc.script.length > 80, "demo ships a real narration script (voice stage)");
  assert.ok(doc.plan.includes("\n") && doc.roadmap.includes("\n"));
  assert.ok(Array.isArray(doc.cards) && doc.cards.length >= 5, "demo shows a full storyboard");
  assert.ok(Array.isArray(doc.publish.platforms) && doc.publish.platforms.length >= 1);
});

test("every demo card is well-formed and gets an injected visual", () => {
  const doc = buildDemoProject({ visual: (kind, label, sub) => `svg:${kind}:${label}:${sub}`, schemaVersion: 4 });
  for (const card of doc.cards) {
    assert.ok(card.id && typeof card.id === "string");
    assert.ok(card.title && card.text);
    assert.equal(typeof card.x, "number");
    assert.equal(typeof card.y, "number");
    assert.ok(Array.isArray(card.tags));
    assert.match(card.image, /^svg:/, "card image comes from the injected visual() generator");
  }
  const ids = doc.cards.map(card => card.id);
  assert.equal(new Set(ids).size, ids.length, "card ids are unique");
});

test("demo links reference real card ids only", () => {
  const doc = buildDemoProject({ visual: () => "" });
  const ids = new Set(doc.cards.map(card => card.id));
  for (const [from, to] of doc.links) {
    assert.ok(ids.has(from), `link source ${from} exists`);
    assert.ok(ids.has(to), `link target ${to} exists`);
  }
});

test("demo contains no secrets or credential hints", () => {
  const doc = buildDemoProject({ visual: () => "" });
  const serialized = JSON.stringify(doc);
  assert.doesNotMatch(serialized, SECRET_HINTS);
});

// Две доски — два разных обещания, и расходятся они намеренно. Демо обязано
// открываться офлайн, поэтому у него фоны выключены (проверка выше). Доска,
// которую человек заводит сам, наоборот, должна сразу показывать продукт таким,
// каким его обещает интерфейс, — иначе «Собрать видео» отдаёт тёмную подложку.
// Тест текстовый, потому что app.js — браузерный модуль и в Node не грузится.
test("a board a person starts themselves has scene backgrounds on", () => {
  const app = readFileSync(new URL("../../src/app.js", import.meta.url), "utf8");
  const starter = app.slice(app.indexOf("function starterState()"));
  const brief = starter.slice(starter.indexOf("brief: {"), starter.indexOf("plan: ["));
  assert.match(brief, /generateVisuals:\s*true/, "новая доска стартует с включёнными фонами сцен");
  assert.match(brief, /brollMode:\s*"auto"/, "и берёт бесплатные источники раньше платных");
});

test("demo build is deterministic (same output every call)", () => {
  const a = JSON.stringify(buildDemoProject({ visual: (k, l) => `${k}:${l}`, schemaVersion: 4 }));
  const b = JSON.stringify(buildDemoProject({ visual: (k, l) => `${k}:${l}`, schemaVersion: 4 }));
  assert.equal(a, b);
});
