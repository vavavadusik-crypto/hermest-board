import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("board UI wires a human-readable provider diagnostics panel", async () => {
  const html = await readFile("index.html", "utf8");
  const app = await readFile("src/app.js", "utf8");

  // Panel + accessible states present in markup.
  for (const id of ["checkProviderDiagnostics", "providerDiagnostics", "providerDiagnosticsStatus", "providerDiagnosticsList"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="providerDiagnostics"[^>]*role="region"/);
  assert.match(html, /id="providerDiagnosticsStatus"[^>]*role="status"[^>]*aria-live="polite"/);

  // Uses the tested label module and real capability endpoint, not raw dumps.
  assert.match(app, /from "\.\/ui\/connector-labels\.js"/);
  assert.match(app, /productApi\("connectors\/capabilities"\)/);
  assert.match(app, /async function loadProviderDiagnostics/);
  // Loading + empty + error/retry states exist.
  assert.match(app, /Проверяю провайдеров…/);
  assert.match(app, /Данные о провайдерах сейчас недоступны\./);
  assert.match(app, /className = "diagnostics-retry"/);
  assert.match(app, /addEventListener\("click", loadProviderDiagnostics\)/);
  // Safe DOM: no innerHTML on the diagnostics list.
  assert.doesNotMatch(app, /providerDiagnosticsList\.innerHTML/);
});
