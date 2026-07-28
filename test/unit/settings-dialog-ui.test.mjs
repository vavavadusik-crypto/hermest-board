import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings open in an accessible native dialog with tabbed sections", async () => {
  const html = await readFile("index.html", "utf8");
  const app = await readFile("src/app.js", "utf8");

  const dialogMatch = /<dialog\b(?=[^>]*\bid="settingsDialog")(?=[^>]*\baria-labelledby="settingsDialogTitle")[^>]*>[\s\S]*?<\/dialog>/.exec(html);
  assert.ok(dialogMatch, "native settings dialog is labelled");
  const dialogHtml = dialogMatch[0];

  assert.match(dialogHtml, /role="tablist"/);

  const tabs = [
    ["settingsTabAccount", "settingsPanelAccount"],
    ["settingsTabAi", "settingsPanelAi"],
    ["settingsTabApiKeys", "settingsPanelApiKeys"],
    ["settingsTabDiagnostics", "settingsPanelDiagnostics"]
  ];
  for (const [index, [tabId, panelId]] of tabs.entries()) {
    const tabMatch = new RegExp(
      `<button\\b(?=[^>]*\\bid="${tabId}")(?=[^>]*\\brole="tab")(?=[^>]*\\baria-selected="(?:true|false)")(?=[^>]*\\baria-controls="${panelId}")(?=[^>]*\\btabindex="(?:0|-1)")[^>]*>`
    ).exec(dialogHtml);
    assert.ok(tabMatch, `tab ${tabId} has the required ARIA relationship`);

    const panelMatch = new RegExp(
      `<section\\b(?=[^>]*\\bid="${panelId}")(?=[^>]*\\brole="tabpanel")(?=[^>]*\\baria-labelledby="${tabId}")[^>]*>`
    ).exec(dialogHtml);
    assert.ok(panelMatch, `panel ${panelId} is labelled by its tab`);
    if (index > 0) assert.match(panelMatch[0], /\shidden(?:\s|>)/, `inactive panel ${panelId} is hidden`);
  }

  const movedIds = [
    "settingsPanel",
    "accountStatus", "accountEmail", "accountDisplayName", "accountPassword",
    "checkAccountStatus", "signupAccount", "loginAccount", "logoutAccount",
    "aiProvider", "aiModel", "aiKey", "aiRemember", "aiPrompt", "saveAiSettings",
    "clearAiSettings", "testAiConnection", "runAiAssistant", "addAiResponseCard", "aiResponseOutput",
    "userApiKeyList", "apiCatalogCategory", "userApiKeyProvider", "apiProviderInfo",
    "userApiKeyLabel", "userApiKeyValue", "saveUserApiKey", "openProviderDocs",
    "activateNoKeyProvider", "clearUserApiKeys",
    "checkProviderDiagnostics", "providerDiagnostics", "providerDiagnosticsStatus", "providerDiagnosticsList"
  ];
  for (const id of movedIds) {
    assert.match(dialogHtml, new RegExp(`\\bid="${id}"`), `${id} lives inside the settings dialog`);
  }

  assert.match(
    app,
    /openSettingsButton\.addEventListener\("click",[\s\S]*?settingsDialog\.showModal\(\)/
  );
  assert.match(
    app,
    /settingsDialog\.addEventListener\("close",[\s\S]*?openSettingsButton\.focus\(\)/
  );
  assert.doesNotMatch(app, /settingsPanel\.scrollIntoView/);
});
