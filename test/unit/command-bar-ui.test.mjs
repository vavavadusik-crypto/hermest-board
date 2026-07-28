import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile("index.html", "utf8");
const app = await readFile("src/app.js", "utf8");

/** Кусок разметки от открывающего тега с данным id до его закрывающего тега. */
function sectionOf(openTagPattern, closeTag) {
  const start = html.search(openTagPattern);
  assert.ok(start >= 0, `section ${openTagPattern} exists`);
  const end = html.indexOf(closeTag, start);
  assert.ok(end > start, `section ${openTagPattern} is closed`);
  return html.slice(start, end);
}

test("the top bar carries the whole entry point: topic, duration, one button", () => {
  const bar = sectionOf(/<form class="command-bar" id="commandBar"/, "</form>");
  assert.match(bar, /<input id="wizardTopic" type="text"[^>]*maxlength="300"/);
  assert.match(bar, /<input id="durationSlider" type="range"/);
  assert.match(bar, /<input id="durationValue" type="text"/);
  assert.match(bar, /<button id="wizardDraft" type="submit"/);
  // Верх — строка и кнопка: никаких селектов и чекбоксов рядом с ними.
  assert.doesNotMatch(bar, /<select/);
  assert.doesNotMatch(bar, /type="checkbox"/);
});

test("the duration control is free, not a preset list", () => {
  const bar = sectionOf(/<form class="command-bar" id="commandBar"/, "</form>");
  assert.match(bar, /id="durationSlider"[^>]*step="1"/);
  assert.match(bar, /id="durationSlider"[^>]*min="0"/);
  // Быстрые метки — дополнение: отдельная группа, а не подмена ползунка.
  assert.match(bar, /id="durationQuick"[^>]*role="group"/);
  assert.match(bar, /<datalist id="durationMarks">/);
  assert.match(app, /durationSlider\.max = String\(DURATION_SLIDER_MAX_POSITION\)/);
});

test("every command-bar control has a name and the status is announced", () => {
  assert.match(html, /<label for="wizardTopic">/);
  assert.match(html, /<span class="command-legend" id="durationLegend">/);
  assert.match(html, /id="durationSlider"[^>]*aria-label="[^"]+"/);
  assert.match(html, /id="durationSlider"[^>]*aria-describedby="durationHint"/);
  assert.match(html, /<label class="visually-hidden" for="durationValue">/);
  assert.match(html, /id="wizardStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="durationWarning"[^>]*role="alert"/);
  assert.match(html, /id="durationNotice"[^>]*role="status"[^>]*aria-live="polite"/);
  // Видимый фокус для клавиатурного прохода по строке.
  assert.match(html, /\.topbar :focus-visible,[\s\S]{0,80}outline: 2px solid var\(--accent\)/);
});

test("settings moved into the video mode instead of being copied", () => {
  assert.doesNotMatch(html, /topic-wizard-panel/);
  const videoStart = html.indexOf('id="modePanelVideo"');
  const videoEnd = html.indexOf('id="modePanelPublish"', videoStart);
  assert.ok(videoStart >= 0 && videoEnd > videoStart, "video mode exists before publish mode");
  const settings = html.slice(videoStart, videoEnd);
  for (const id of [
    "wizardSceneCount", "wizardResearch", "wizardModel", "wizardByokConfig",
    "narrationLanguage", "narrationVoice", "narrationProvider",
    "musicBed", "brollMode", "generateVisualsToggle", "byokProviders"
  ]) {
    assert.match(settings, new RegExp(`id="${id}"`), `${id} lives in the settings block`);
    assert.equal(
      html.split(`id="${id}"`).length - 1,
      1,
      `${id} appears exactly once — settings moved, not duplicated`
    );
  }
  assert.match(settings, /<label for="wizardSceneCount">/);
  assert.match(settings, /<label for="narrationLanguage">/);
  for (const heading of ["Сценарий", "Звук", "Картинка", "Готовый файл"]) {
    assert.match(settings, new RegExp(`<h2>${heading}</h2>`), `video mode has ${heading}`);
  }
});

test("Enter in the command bar starts the build through one submit path", () => {
  assert.match(app, /commandBar\.addEventListener\("submit", event => \{/);
  assert.match(app, /event\.preventDefault\(\);/);
  assert.match(app, /commitTypedDuration\(\);\s*\n\s*void draftFromTopic\(\);/);
  // Кнопка — submit, поэтому второго обработчика клика быть не должно.
  assert.doesNotMatch(app, /wizardDraftButton\.addEventListener\("click"/);
});

test("the draft request carries the chosen duration and lets the system pick scenes", () => {
  assert.match(app, /\.\.\.\(sceneCount === null \? \{\} : \{ sceneCount \}\),\s*\n\s*targetDurationSeconds,/);
  assert.match(app, /const sceneCount = manualSceneCount\(\);/);
  assert.match(app, /deriveSceneCountFromDuration\(targetDurationSeconds/);
});

test("the hint and the planner warning are rendered as text, never as markup", () => {
  assert.match(app, /durationHint\.textContent = hint\.text;/);
  assert.match(app, /durationWarning\.textContent = buildDurationWarning\(\{/);
  assert.doesNotMatch(app, /durationHint\.innerHTML/);
  assert.doesNotMatch(app, /durationWarning\.innerHTML/);
  assert.doesNotMatch(app, /wizardStatus\.innerHTML/);
  // Тема и набранная длительность — внешний ввод: только textContent.
  assert.match(app, /showDurationNotice\(`Не понял «\$\{String\(typed\)\.slice\(0, 24\)\}»/);
  assert.doesNotMatch(app, /durationNotice\.innerHTML/);
});

test("a note about typing clears itself instead of outliving the input", () => {
  assert.match(app, /durationNotice\.hidden = !text;/);
  // Корректный ввод и движение ползунка гасят прошлое замечание.
  assert.match(app, /showDurationNotice\(result\.clamped[\s\S]{0,220}: ""\);/);
  assert.match(app, /removeAttribute\("aria-invalid"\);\s*\n\s*\/\/[^\n]*\n\s*showDurationNotice\(""\);/);
});

test("the side panel is positioned from the measured bar height", () => {
  assert.match(html, /top: calc\(var\(--topbar-height, 54px\) \+ 24px\)/);
  assert.match(app, /setProperty\("--topbar-height"/);
});

test("mobile width keeps the command bar in one column and moves the rail down", () => {
  const mobile = html.slice(html.indexOf("@media (max-width: 899px)"));
  assert.match(mobile, /\.command-bar \{\s*grid-template-columns: 1fr;/);
  assert.match(mobile, /\.mode-rail \{[\s\S]*?inset: auto 0 0;/);
  assert.match(mobile, /\.side-panel \{[\s\S]*?left: 8px;[\s\S]*?right: 8px;[\s\S]*?width: auto;/);
});
