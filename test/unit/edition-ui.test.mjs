import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { friendlyErrorMessage } from "../../src/ui/user-messages.js";

test("board HTML exposes an accessible edition trigger on the render panel", async () => {
  const html = await readFile("index.html", "utf8");
  assert.match(html, /id="editionPanel"[^>]*aria-label="[^"]+"/);
  const langSelect = /<select id="editionLanguage"[^>]*>/.exec(html);
  assert.ok(langSelect, "editionLanguage select exists");
  assert.match(langSelect[0], /aria-label="[^"]+"/);
  const button = /<button id="createEdition"[^>]*>/.exec(html);
  assert.ok(button, "createEdition button exists");
  assert.match(button[0], /aria-label="[^"]+"/);
  const status = /<div[^>]*id="editionStatus"[^>]*>/.exec(html);
  assert.ok(status, "editionStatus region exists");
  assert.match(status[0], /role="status"/);
  assert.match(status[0], /aria-live="polite"/);
});

test("app wires the edition flow to the POST /edition endpoint and reuses render", async () => {
  const app = await readFile("src/app.js", "utf8");
  assert.match(app, /getElementById\("editionPanel"\)/);
  assert.match(app, /getElementById\("createEdition"\)/);
  assert.match(app, /createEditionButton\.addEventListener\("click", createEdition\)/);
  assert.match(app, /async function createEdition\(/);
  assert.match(app, /"\/api\/local-media\/edition"/);
  assert.match(app, /function populateEditionLanguages\(/);
  assert.match(app, /function revealEditionPanel\(/);
  // Panel is revealed only after a completed render (on a finished project).
  assert.match(app, /revealEditionPanel\(\)/);
  // The ready translated project is rendered through the existing render path.
  assert.match(app, /await renderLocalVideo\(data\.project\)/);
  assert.match(app, /async function renderLocalVideo\(projectOverride\)/);
  // Status maps every edition outcome (ready / voice_missing / error) without raw codes.
  assert.match(app, /edition\.status === "ready"/);
  assert.match(app, /edition\.status === "voice_missing" \|\| edition\.status === "error"/);
});

test("friendly messages cover the edition flow", () => {
  assert.equal(
    friendlyErrorMessage({ payload: { code: "edition_project_invalid" } }, "edition"),
    "Сначала собери готовый ролик, затем создай издание."
  );
  // Unknown edition error falls back to the edition-specific sentence, not a raw code.
  const fallback = friendlyErrorMessage({ payload: { code: "totally_unknown_x" } }, "edition");
  assert.match(fallback, /издание/i);
  assert.doesNotMatch(fallback, /_|\{|\}/);
});
