import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile("index.html", "utf8");
const app = await readFile("src/app.js", "utf8");

function attribute(tag, name) {
  return new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1] || "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("рейка связывает четыре режима с четырьмя панелями", () => {
  const railStart = html.search(/<nav\b(?=[^>]*\bid="modeTablist")(?=[^>]*\brole="tablist")(?=[^>]*\baria-orientation="vertical")[^>]*>/);
  assert.ok(railStart >= 0, "вертикальная рейка режимов существует");
  const railEnd = html.indexOf("</nav>", railStart);
  assert.ok(railEnd > railStart, "рейка режимов закрыта");
  const rail = html.slice(railStart, railEnd);
  const tabs = rail.match(/<button\b(?=[^>]*\brole="tab")[^>]*>/g) || [];

  assert.equal(tabs.length, 4, "в рейке ровно четыре вкладки-режима");
  const controlledPanels = new Set();
  for (const tab of tabs) {
    const tabId = attribute(tab, "id");
    const panelId = attribute(tab, "aria-controls");
    assert.ok(tabId, "у вкладки есть id");
    assert.ok(panelId, `${tabId} указывает на панель`);
    controlledPanels.add(panelId);

    const panel = new RegExp(
      `<section\\b(?=[^>]*\\bid="${escapeRegExp(panelId)}")` +
      `(?=[^>]*\\brole="tabpanel")` +
      `(?=[^>]*\\baria-labelledby="${escapeRegExp(tabId)}")[^>]*>`
    );
    assert.match(html, panel, `${tabId} и ${panelId} связаны в обе стороны`);
  }

  assert.deepEqual(controlledPanels, new Set([
    "modePanelBoard",
    "modePanelVideo",
    "modePanelPublish",
    "modePanelStorage"
  ]));
});

test("производственные настройки больше не спрятаны в details", () => {
  assert.doesNotMatch(
    html,
    /<details\b[^>]*\bclass="[^"]*\bcommand-settings\b[^"]*"/,
    "старого раскрывающегося блока нет"
  );
});

test("каждый строковый getElementById из приложения существует в разметке", () => {
  const referencedIds = new Set(
    [...app.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map(match => match[1])
  );
  assert.ok(referencedIds.size > 0, "в app.js найдены DOM-зависимости");

  for (const id of referencedIds) {
    assert.match(
      html,
      new RegExp(`\\bid="${escapeRegExp(id)}"`),
      `id="${id}" присутствует в index.html`
    );
  }
});
