import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("icon-only board controls carry an accessible name (aria-label)", async () => {
  const html = await readFile("index.html", "utf8");
  const iconButtons = [
    "addCard", "connectMode", "fitView", "openSettings", "openWelcome", "togglePanel",
    "recordMode", "exportJson", "importJson", "bringFront", "duplicateCard", "deleteCard"
  ];
  for (const id of iconButtons) {
    const match = new RegExp(`<button\\b(?=[^>]*\\bid="${id}")[^>]*>`).exec(html);
    assert.ok(match, `button ${id} exists`);
    assert.match(match[0], /aria-label="[^"]+"/, `button ${id} has aria-label`);
  }
});

test("welcome overlay clarifies the four access modes (local/free/BYOK/cloud)", async () => {
  const html = await readFile("index.html", "utf8");
  assert.match(html, /class="welcome-modes"/);
  assert.match(html, /Локально и бесплатно/);
  assert.match(html, /BYOK/);
  assert.match(html, /Облако/);
});
