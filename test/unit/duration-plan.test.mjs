import assert from "node:assert/strict";
import test from "node:test";

import {
  DURATION_PLAN_LIMITS,
  buildDurationWarning,
  clampLengthScale,
  countNarrationCharacters,
  deriveSceneCountFromDuration,
  describeDurationBudget,
  estimateNarrationCharacters,
  estimateNarrationDurationMs,
  formatDurationLabel,
  normalizeLengthScale,
  normalizeTargetDurationSeconds,
  parseDurationLabel,
  planTargetDuration
} from "../../src/domain/duration-plan.js";

const scenes = (count, durationMs) => Array.from({ length: count }, () => durationMs);

test("target duration is reached with padding alone when the corridor allows it", () => {
  const plan = planTargetDuration({
    targetDurationSeconds: 52,
    measuredSceneDurationsMs: scenes(5, 10000),
    narrationCharacters: 800
  });

  assert.equal(plan.status, "on_target");
  assert.equal(plan.paddingMs, 400);
  assert.equal(plan.lengthScale, 1);
  assert.equal(plan.previousLengthScale, 1);
  assert.equal(plan.projectedDurationMs, 52000);
  assert.equal(plan.deviationMs, 0);
  assert.equal(plan.warning, null);
});

test("padding-only planning still lands inside the +-0.5s tolerance after clamping", () => {
  const plan = planTargetDuration({
    targetDurationSeconds: 20,
    measuredSceneDurationsMs: scenes(2, 10000),
    allowResynthesis: false
  });

  assert.equal(plan.status, "on_target");
  assert.equal(plan.paddingMs, DURATION_PLAN_LIMITS.minPaddingMs);
  assert.equal(plan.projectedDurationMs, 20300);
  assert.equal(plan.deviationMs, 300);
  assert.ok(Math.abs(plan.deviationMs) <= DURATION_PLAN_LIMITS.toleranceMs);
});

test("target duration outside the padding corridor asks for one resynthesis pass", () => {
  const firstPass = planTargetDuration({
    targetDurationSeconds: 46,
    measuredSceneDurationsMs: scenes(5, 10000),
    narrationCharacters: 706
  });

  assert.equal(firstPass.status, "resynthesize");
  // (46000 - 5 * 400) / 50000 = 0.88 — темп внутри слышимо-безопасного коридора.
  assert.equal(firstPass.lengthScale, 0.88);
  assert.equal(firstPass.previousLengthScale, 1);
  assert.equal(firstPass.projectedDurationMs, null);
  assert.equal(firstPass.deviationMs, null);

  // Второй проход синтеза: сцены сжались ровно на новый темп.
  const resynthesized = scenes(5, Math.round(10000 * firstPass.lengthScale));
  const secondPass = planTargetDuration({
    targetDurationSeconds: 46,
    measuredSceneDurationsMs: resynthesized,
    narrationCharacters: 706,
    lengthScale: firstPass.lengthScale,
    allowResynthesis: false
  });

  assert.equal(secondPass.status, "on_target");
  assert.equal(secondPass.lengthScale, 0.88);
  assert.equal(secondPass.paddingMs, 400);
  assert.equal(secondPass.projectedDurationMs, 46000);
  assert.equal(secondPass.deviationMs, 0);
  assert.equal(secondPass.warning, null);
});

test("speech rate is clamped at both ends of the 0.85-1.15 corridor", () => {
  const tooFast = planTargetDuration({
    targetDurationSeconds: 40,
    measuredSceneDurationsMs: scenes(5, 10000)
  });
  assert.equal(tooFast.status, "resynthesize");
  assert.equal(tooFast.lengthScale, DURATION_PLAN_LIMITS.minLengthScale);

  const tooSlow = planTargetDuration({
    targetDurationSeconds: 40,
    measuredSceneDurationsMs: scenes(5, 5000)
  });
  assert.equal(tooSlow.status, "resynthesize");
  assert.equal(tooSlow.lengthScale, DURATION_PLAN_LIMITS.maxLengthScale);

  assert.equal(clampLengthScale(0.1), DURATION_PLAN_LIMITS.minLengthScale);
  assert.equal(clampLengthScale(9), DURATION_PLAN_LIMITS.maxLengthScale);
  assert.equal(clampLengthScale(1.02), 1.02);
  assert.throws(() => clampLengthScale("быстрее"), TypeError);
});

test("length scale normalization rejects hostile input and keeps the corridor", () => {
  assert.equal(normalizeLengthScale(undefined), 1);
  assert.equal(normalizeLengthScale(null), 1);
  assert.equal(normalizeLengthScale(""), 1);
  assert.equal(normalizeLengthScale("0.9"), 0.9);
  assert.throws(() => normalizeLengthScale(true), TypeError);
  assert.throws(() => normalizeLengthScale(Number.NaN), TypeError);
  assert.throws(() => normalizeLengthScale(Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => normalizeLengthScale(0.5), RangeError);
  assert.throws(() => normalizeLengthScale(1.5), RangeError);
});

test("too little text produces a warning with the actual character numbers", () => {
  const plan = planTargetDuration({
    targetDurationSeconds: 60,
    measuredSceneDurationsMs: scenes(3, 3000),
    narrationCharacters: 144,
    allowResynthesis: false
  });

  assert.equal(plan.status, "out_of_range");
  assert.equal(plan.paddingMs, DURATION_PLAN_LIMITS.maxPaddingMs);
  assert.equal(plan.projectedDurationMs, 13500);
  assert.equal(plan.deviationMs, -46500);
  assert.equal(plan.budget.status, "short");
  assert.equal(plan.budget.recommendedCharacters, 944);
  assert.match(plan.warning, /1:00/);
  assert.match(plan.warning, /944/);
  assert.match(plan.warning, /144/);
  assert.match(plan.warning, /0:14/);
});

test("too much text produces a warning that asks for shorter narration", () => {
  const plan = planTargetDuration({
    targetDurationSeconds: 30,
    measuredSceneDurationsMs: scenes(5, 20000),
    narrationCharacters: 1605,
    allowResynthesis: false
  });

  assert.equal(plan.status, "out_of_range");
  assert.equal(plan.paddingMs, DURATION_PLAN_LIMITS.minPaddingMs);
  assert.equal(plan.projectedDurationMs, 100750);
  assert.equal(plan.deviationMs, 70750);
  assert.equal(plan.budget.status, "long");
  assert.equal(plan.budget.recommendedCharacters, 449);
  assert.match(plan.warning, /слишком много/);
  assert.match(plan.warning, /449/);
  assert.match(plan.warning, /1605/);
});

test("an adapter without speech-rate support never triggers resynthesis", () => {
  const plan = planTargetDuration({
    targetDurationSeconds: 46,
    measuredSceneDurationsMs: scenes(5, 10000),
    narrationCharacters: 706,
    allowResynthesis: false
  });

  assert.notEqual(plan.status, "resynthesize");
  assert.equal(plan.lengthScale, 1);
});

test("planTargetDuration refuses to plan without a target or without measurements", () => {
  assert.throws(() => planTargetDuration({ measuredSceneDurationsMs: scenes(3, 1000) }), TypeError);
  assert.throws(() => planTargetDuration({ targetDurationSeconds: 60 }), TypeError);
  assert.throws(
    () => planTargetDuration({ targetDurationSeconds: 60, measuredSceneDurationsMs: [] }),
    TypeError
  );
  assert.throws(
    () => planTargetDuration({ targetDurationSeconds: 60, measuredSceneDurationsMs: [1000, 0] }),
    TypeError
  );
  assert.throws(
    () => planTargetDuration({ targetDurationSeconds: 60, measuredSceneDurationsMs: [1000, "нет"] }),
    TypeError
  );
});

test("an unset target duration keeps the previous pipeline behaviour", () => {
  assert.equal(normalizeTargetDurationSeconds(undefined), null);
  assert.equal(normalizeTargetDurationSeconds(null), null);
  assert.equal(normalizeTargetDurationSeconds(""), null);
  assert.equal(describeDurationBudget({ narrationCharacters: 500, sceneCount: 5 }).status, "unset");
  assert.equal(describeDurationBudget({}).targetDurationSeconds, null);
});

test("target duration normalization treats the value as hostile input", () => {
  assert.equal(normalizeTargetDurationSeconds(60), 60);
  assert.equal(normalizeTargetDurationSeconds("155"), 155);
  assert.equal(normalizeTargetDurationSeconds(60.4), 60);
  assert.equal(normalizeTargetDurationSeconds(DURATION_PLAN_LIMITS.minTargetSeconds), 15);
  assert.equal(normalizeTargetDurationSeconds(DURATION_PLAN_LIMITS.maxTargetSeconds), 3600);
  assert.throws(() => normalizeTargetDurationSeconds(true), TypeError);
  assert.throws(() => normalizeTargetDurationSeconds(Number.NaN), TypeError);
  assert.throws(() => normalizeTargetDurationSeconds(Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => normalizeTargetDurationSeconds("минута"), TypeError);
  assert.throws(() => normalizeTargetDurationSeconds({}), TypeError);
  assert.throws(() => normalizeTargetDurationSeconds(14), RangeError);
  assert.throws(() => normalizeTargetDurationSeconds(3601), RangeError);
  assert.throws(() => normalizeTargetDurationSeconds(-60), RangeError);
});

test("duration labels round-trip between m:ss and seconds", () => {
  assert.equal(formatDurationLabel(155), "2:35");
  assert.equal(parseDurationLabel("2:35"), 155);
  assert.equal(formatDurationLabel(15), "0:15");
  assert.equal(parseDurationLabel("0:15"), 15);
  assert.equal(formatDurationLabel(63), "1:03");
  assert.equal(parseDurationLabel("1:03"), 63);
  assert.equal(formatDurationLabel(3600), "1:00:00");
  assert.equal(parseDurationLabel("1:00:00"), 3600);
  assert.equal(formatDurationLabel(0), "0:00");
  assert.equal(parseDurationLabel("90"), 90);
});

test("duration label parsing returns null on anything that is not a duration", () => {
  for (const junk of ["", "   ", "минута", "2:35:", ":35", "2:60", "1:00:99", "-5", "2,35", "1:2:3:4", "0x10"]) {
    assert.equal(parseDurationLabel(junk), null, junk);
  }
  assert.equal(parseDurationLabel(Number.NaN), null);
  assert.equal(parseDurationLabel(Number.POSITIVE_INFINITY), null);
  assert.equal(parseDurationLabel(true), null);
  assert.equal(parseDurationLabel(null), null);
  assert.equal(parseDurationLabel(undefined), null);
  assert.equal(parseDurationLabel({}), null);
  assert.equal(parseDurationLabel(-1), null);
  assert.equal(parseDurationLabel(155), 155);
});

test("scene count derived from duration stays sane from a minute to an hour", () => {
  const minute = deriveSceneCountFromDuration(60);
  assert.equal(minute.sceneCount, 7);
  assert.equal(minute.capped, false);

  const short = deriveSceneCountFromDuration(15);
  assert.equal(short.sceneCount, 2);

  const hour = deriveSceneCountFromDuration(3600);
  assert.equal(hour.sceneCount, 12);
  assert.equal(hour.capped, true);
  assert.ok(hour.recommendedSceneCount > 12);

  const tenMinutesCapped = deriveSceneCountFromDuration(600, { maxScenes: 40 });
  assert.equal(tenMinutesCapped.sceneCount, 40);
  assert.equal(tenMinutesCapped.capped, true);

  const tenMinutesUncapped = deriveSceneCountFromDuration(600, { maxScenes: 200 });
  assert.equal(tenMinutesUncapped.sceneCount, tenMinutesUncapped.recommendedSceneCount);
  assert.equal(tenMinutesUncapped.capped, false);
  assert.ok(tenMinutesUncapped.sceneCount > 12);
  assert.equal(deriveSceneCountFromDuration(null).sceneCount, 2);
  assert.equal(deriveSceneCountFromDuration(Number.NaN).sceneCount, 2);
  assert.equal(deriveSceneCountFromDuration(-60).sceneCount, 2);
});

test("character budget describes what the chosen duration needs", () => {
  const budget = describeDurationBudget({
    targetDurationSeconds: 60,
    narrationCharacters: 774,
    sceneCount: 6
  });

  assert.equal(budget.status, "ok");
  assert.ok(budget.minCharacters < budget.recommendedCharacters);
  assert.ok(budget.recommendedCharacters < budget.maxCharacters);
  assert.ok(budget.narrationCharacters >= budget.minCharacters);
  assert.ok(budget.narrationCharacters <= budget.maxCharacters);

  assert.equal(describeDurationBudget({ targetDurationSeconds: 60, narrationCharacters: 10, sceneCount: 6 }).status, "short");
  assert.equal(describeDurationBudget({ targetDurationSeconds: 60, narrationCharacters: 9000, sceneCount: 6 }).status, "long");
});

test("narration character counting and duration estimation agree with each other", () => {
  assert.equal(countNarrationCharacters("Привет,  мир!\nВторая строка."), 24);
  assert.equal(countNarrationCharacters(""), 0);
  assert.equal(countNarrationCharacters(null), 0);
  assert.equal(countNarrationCharacters(42), 0);

  const characters = 774;
  const estimatedMs = estimateNarrationDurationMs(characters);
  assert.equal(estimatedMs, Math.round(characters * DURATION_PLAN_LIMITS.msPerNarrationCharacter));
  assert.equal(estimateNarrationCharacters(estimatedMs), characters);
  assert.equal(
    estimateNarrationDurationMs(characters, 0.9),
    Math.round(characters * DURATION_PLAN_LIMITS.msPerNarrationCharacter * 0.9)
  );
  assert.equal(estimateNarrationDurationMs(-5), 0);
  assert.equal(estimateNarrationCharacters(-5), 0);
});

test("duration warning names both the target and what actually comes out", () => {
  const budget = describeDurationBudget({
    targetDurationSeconds: 155,
    narrationCharacters: 200,
    sceneCount: 4
  });
  const warning = buildDurationWarning({ target: 155, projectedDurationMs: 40000, budget });

  assert.match(warning, /2:35/);
  assert.match(warning, /0:40/);
  assert.match(warning, /200/);
  assert.match(warning, new RegExp(String(budget.recommendedCharacters)));
});
