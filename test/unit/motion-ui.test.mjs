import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile("index.html", "utf8");
const app = await readFile("src/app.js", "utf8");

test("video mode exposes two accessible motion radiogroups with every product choice", () => {
  for (const id of ["motionDepthGroup", "motionCharacterGroup", "motionPreview"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.ok(app.includes(`getElementById("${id}")`));
  }
  assert.match(html, /id="motionDepthGroup"[^>]*role="radiogroup"/);
  assert.match(html, /id="motionCharacterGroup"[^>]*role="radiogroup"/);
  for (const depth of ["still", "flat", "depth", "space"]) {
    assert.match(html, new RegExp(`data-motion-depth="${depth}"`));
  }
  for (const character of ["calm", "lively", "cinematic"]) {
    assert.match(html, new RegExp(`data-motion-character="${character}"`));
  }
  assert.match(html, /Объёмная.*защитной зоны/su);
  assert.match(html, /контрольном замере 1920×1080 \/ 12 кадров.*1%/su);
});

test("motion selection uses roving tabindex, arrow keys, and the real scene markup preview", () => {
  assert.match(app, /function wireMotionRadioGroup/);
  assert.match(app, /ArrowRight: 1/);
  assert.match(app, /ArrowLeft: -1/);
  assert.match(app, /ArrowUp: -1/);
  assert.match(app, /ArrowDown: 1/);
  assert.match(app, /radio\.tabIndex = checked \? 0 : -1/);
  assert.match(app, /state\.brief\.motion/);
  assert.match(app, /normalizeSceneMotion\(source\.motion \?\? fallback\.motion\)/);
  assert.match(app, /buildSceneMarkup\(\{/);
  assert.match(app, /motionPreview\.srcdoc/);
  assert.match(app, /setInterval/);
});
