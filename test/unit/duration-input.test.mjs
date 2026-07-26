import assert from "node:assert/strict";
import test from "node:test";

import { DURATION_PLAN_LIMITS, describeDurationBudget, parseDurationLabel } from "../../src/domain/duration-plan.js";
import {
  DEFAULT_TARGET_DURATION_SECONDS,
  DURATION_QUICK_MARKS,
  DURATION_SLIDER_MAX_POSITION,
  DURATION_SLIDER_STOPS,
  describeDurationHint,
  resolveTypedDuration,
  secondsToSliderPosition,
  sliderPositionToSeconds,
  snapDurationSeconds
} from "../../src/ui/duration-input.js";

test("slider scale covers the whole allowed range and only grows", () => {
  assert.equal(DURATION_SLIDER_STOPS[0], DURATION_PLAN_LIMITS.minTargetSeconds);
  assert.equal(DURATION_SLIDER_STOPS.at(-1), DURATION_PLAN_LIMITS.maxTargetSeconds);
  assert.equal(DURATION_SLIDER_MAX_POSITION, DURATION_SLIDER_STOPS.length - 1);
  for (let index = 1; index < DURATION_SLIDER_STOPS.length; index += 1) {
    assert.ok(
      DURATION_SLIDER_STOPS[index] > DURATION_SLIDER_STOPS[index - 1],
      `stop ${index} (${DURATION_SLIDER_STOPS[index]}) must exceed the previous one`
    );
  }
});

test("scale is non-linear: one second on short clips, coarser on long ones", () => {
  const stepAt = seconds => {
    const index = DURATION_SLIDER_STOPS.indexOf(seconds);
    assert.ok(index > 0, `${seconds} must be a slider stop`);
    return DURATION_SLIDER_STOPS[index] - DURATION_SLIDER_STOPS[index - 1];
  };
  assert.equal(stepAt(63), 1);
  assert.equal(stepAt(155), 1);
  assert.equal(stepAt(600), 5);
  assert.equal(stepAt(1200), 15);
  assert.equal(stepAt(3600), 30);
});

test("the durations the owner named are reachable exactly", () => {
  // «минуту и три секунды», «две минуты тридцать пять секунд», «целый час»
  for (const label of ["1:03", "2:35", "1:00:00"]) {
    const seconds = parseDurationLabel(label);
    assert.equal(snapDurationSeconds(seconds), seconds, label);
    assert.equal(sliderPositionToSeconds(secondsToSliderPosition(seconds)), seconds, label);
  }
});

test("slider position and seconds convert back and forth without drift", () => {
  for (let position = 0; position <= DURATION_SLIDER_MAX_POSITION; position += 1) {
    const seconds = sliderPositionToSeconds(position);
    assert.equal(secondsToSliderPosition(seconds), position, `position ${position}`);
  }
});

test("slider edges clamp instead of falling off the scale", () => {
  assert.equal(sliderPositionToSeconds(0), DURATION_PLAN_LIMITS.minTargetSeconds);
  assert.equal(sliderPositionToSeconds(DURATION_SLIDER_MAX_POSITION), DURATION_PLAN_LIMITS.maxTargetSeconds);
  assert.equal(sliderPositionToSeconds(-40), DURATION_PLAN_LIMITS.minTargetSeconds);
  assert.equal(sliderPositionToSeconds(DURATION_SLIDER_MAX_POSITION + 500), DURATION_PLAN_LIMITS.maxTargetSeconds);
  assert.equal(sliderPositionToSeconds(12.4), DURATION_SLIDER_STOPS[12]);
});

test("slider position rejects junk with the default minute, never NaN", () => {
  for (const junk of ["", "  ", "abc", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.equal(sliderPositionToSeconds(junk), DEFAULT_TARGET_DURATION_SECONDS, String(junk));
  }
});

test("snapping bounds the value to the allowed range", () => {
  assert.equal(snapDurationSeconds(2), DURATION_PLAN_LIMITS.minTargetSeconds);
  assert.equal(snapDurationSeconds(99999), DURATION_PLAN_LIMITS.maxTargetSeconds);
  assert.equal(snapDurationSeconds(DURATION_PLAN_LIMITS.minTargetSeconds - 1), DURATION_PLAN_LIMITS.minTargetSeconds);
  assert.equal(snapDurationSeconds(DURATION_PLAN_LIMITS.maxTargetSeconds + 1), DURATION_PLAN_LIMITS.maxTargetSeconds);
  for (const junk of ["", "abc", null, undefined, Number.NaN, {}]) {
    assert.equal(snapDurationSeconds(junk), DEFAULT_TARGET_DURATION_SECONDS, String(junk));
  }
});

test("snapping between stops prefers the shorter neighbour", () => {
  // 1230 и 1245 — соседние остановки; ровно посередине берём не длиннее просимого.
  assert.equal(snapDurationSeconds(1237.5), 1230);
  assert.equal(snapDurationSeconds(1231), 1230);
  assert.equal(snapDurationSeconds(1244), 1245);
  assert.ok(DURATION_SLIDER_STOPS.includes(snapDurationSeconds(1237)));
});

test("quick marks are real stops, not decorations", () => {
  for (const mark of DURATION_QUICK_MARKS) {
    assert.ok(DURATION_SLIDER_STOPS.includes(mark), `${mark} must be a slider stop`);
    assert.equal(sliderPositionToSeconds(secondsToSliderPosition(mark)), mark);
  }
});

test("typed input accepts m:ss and reports what happened", () => {
  const exact = resolveTypedDuration("2:35", 60);
  assert.deepEqual(exact, { seconds: 155, accepted: true, clamped: false, label: "2:35" });

  const withSpaces = resolveTypedDuration("  1:03  ", 60);
  assert.equal(withSpaces.seconds, 63);
  assert.equal(withSpaces.accepted, true);

  const hour = resolveTypedDuration("1:00:00", 60);
  assert.deepEqual(hour, { seconds: 3600, accepted: true, clamped: false, label: "1:00:00" });

  const bareSeconds = resolveTypedDuration("90", 60);
  assert.equal(bareSeconds.seconds, 90);
  assert.equal(bareSeconds.label, "1:30");
});

test("typed input keeps the current value when the text is junk", () => {
  for (const junk of ["", "   ", "abc", "1:2:3:4", "--", "1:99", "12:60", "🙂", null, undefined]) {
    const result = resolveTypedDuration(junk, 155);
    assert.deepEqual(
      result,
      { seconds: 155, accepted: false, clamped: false, label: "2:35" },
      `junk ${String(junk)}`
    );
  }
});

test("typed input out of range is clamped and flagged, not silently taken", () => {
  const tooLong = resolveTypedDuration("2:00:00", 60);
  assert.equal(tooLong.seconds, DURATION_PLAN_LIMITS.maxTargetSeconds);
  assert.equal(tooLong.accepted, true);
  assert.equal(tooLong.clamped, true);
  assert.equal(tooLong.label, "1:00:00");

  const tooShort = resolveTypedDuration("0:03", 60);
  assert.equal(tooShort.seconds, DURATION_PLAN_LIMITS.minTargetSeconds);
  assert.equal(tooShort.clamped, true);

  const offGrid = resolveTypedDuration("20:37", 60);
  assert.equal(offGrid.clamped, true);
  assert.ok(DURATION_SLIDER_STOPS.includes(offGrid.seconds));

  // Испорченное текущее значение не проникает в результат.
  const junkFallback = resolveTypedDuration("nope", "abc");
  assert.equal(junkFallback.seconds, DEFAULT_TARGET_DURATION_SECONDS);
});

test("hint asks for a duration while none is chosen", () => {
  const hint = describeDurationHint({});
  assert.equal(hint.status, "unset");
  assert.match(hint.text, /Выбери длительность/);
  assert.equal(describeDurationHint({ budget: describeDurationBudget({}) }).status, "unset");
});

test("hint on an empty board promises the model will write to the budget", () => {
  const budget = describeDurationBudget({ targetDurationSeconds: 63, narrationCharacters: 0, sceneCount: 3 });
  const hint = describeDurationHint({ budget, sceneCount: 3, hasBoard: false });
  assert.equal(hint.status, "planned");
  assert.match(hint.text, /1:03/);
  assert.match(hint.text, /3 сцены/);
  assert.match(hint.text, new RegExp(`${budget.recommendedCharacters} символов`));
  assert.match(hint.text, /напишет ИИ-модель/);
});

test("hint tells the truth when the board has too little or too much text", () => {
  const short = describeDurationBudget({ targetDurationSeconds: 155, narrationCharacters: 40, sceneCount: 5 });
  const shortHint = describeDurationHint({ budget: short, sceneCount: 5 });
  assert.equal(shortHint.status, "short");
  assert.match(shortHint.text, /2:35/);
  assert.match(shortHint.text, /Сейчас на доске 40\./);
  assert.match(shortHint.text, new RegExp(`минимум ${short.minCharacters}`));

  const long = describeDurationBudget({ targetDurationSeconds: 30, narrationCharacters: 9000, sceneCount: 5 });
  const longHint = describeDurationHint({ budget: long, sceneCount: 5 });
  assert.equal(longHint.status, "long");
  assert.match(longHint.text, /слишком много/);
  assert.match(longHint.text, new RegExp(`максимум ${long.maxCharacters}`));

  const ok = describeDurationBudget({
    targetDurationSeconds: 60,
    narrationCharacters: describeDurationBudget({ targetDurationSeconds: 60, sceneCount: 5 }).recommendedCharacters,
    sceneCount: 5
  });
  const okHint = describeDurationHint({ budget: ok, sceneCount: 5 });
  assert.equal(okHint.status, "ok");
  assert.match(okHint.text, /Объём подходит\./);
});

test("hint pluralises scenes the Russian way", () => {
  const cases = [[1, "1 сцена"], [2, "2 сцены"], [5, "5 сцен"], [11, "11 сцен"], [21, "21 сцена"], [104, "104 сцены"]];
  for (const [sceneCount, expected] of cases) {
    const budget = describeDurationBudget({ targetDurationSeconds: 600, narrationCharacters: 0, sceneCount });
    const hint = describeDurationHint({ budget, sceneCount, hasBoard: false });
    assert.match(hint.text, new RegExp(expected), expected);
  }
});
