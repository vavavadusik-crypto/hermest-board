import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("board UI wires one-click demo entry points and loader", async () => {
  const html = await readFile("index.html", "utf8");
  const app = await readFile("src/app.js", "utf8");

  // Two discoverable entry points: onboarding overlay + always-visible wizard panel.
  assert.match(html, /id="welcomeDemo"/);
  assert.match(html, /id="loadDemoBoard"/);

  // Loader reuses the tested demo module and the proven import path (applyProjectDocument).
  assert.match(app, /from "\.\/ui\/demo-project\.js"/);
  assert.match(app, /function loadDemoProject/);
  assert.match(app, /applyProjectDocument\(buildDemoProject\(/);
  assert.match(app, /getElementById\("loadDemoBoard"\)/);
  assert.match(app, /getElementById\("welcomeDemo"\)/);
});
