import assert from "node:assert/strict";
import test from "node:test";

import {
  ARC_POSITIONS,
  SERIES_PLAN_LIMITS,
  buildEpisodeBrief,
  buildSeriesPrompt,
  parseSeriesPlan,
  planSeriesFromTopic
} from "../../src/domain/series-plan.js";

const validPlan = {
  series: {
    title: "Вайбкодер",
    premise: "Разработчик пишет код вайбами, а прод отвечает ему взаимностью.",
    tone: "сухой юмор",
    visualStyle: "плоская 2D-анимация, кислотные цвета",
    characters: [
      {
        id: "id-от-модели",
        name: "Гоша",
        role: "вайбкодер",
        traits: ["верит промпту", "боится тестов"],
        appearance: "худи, кружка с кофе"
      },
      { name: "Линт", role: "внутренний голос", traits: ["душнила"], appearance: "красная волнистая линия" }
    ],
    runningGags: ["деплой в пятницу"]
  },
  episodes: [
    {
      title: "Первый промпт",
      logline: "Гоша собирает MVP за вечер и никому об этом не говорит.",
      beats: ["промпт", "зелёная сборка", "деплой"],
      arcPosition: "setup",
      carriesForward: ["MVP выкачен без единого теста"]
    },
    {
      title: "Прод горит",
      logline: "Пятничный релиз встречает первых живых пользователей.",
      beats: ["алерт", "откат"],
      carriesForward: ["Линт получил право вето на деплой"]
    },
    {
      title: "Ретро",
      logline: "Команда признаёт, что вайб — не стратегия.",
      beats: ["разбор", "первый тест"],
      carriesForward: ["Гоша написал первый тест"]
    }
  ]
};

function mockModel(responses) {
  const calls = [];
  return {
    calls,
    async complete({ system, prompt, signal }) {
      calls.push({ system, prompt, signal });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  };
}

function planWithEpisodes(count) {
  return {
    ...validPlan,
    episodes: Array.from({ length: count }, (_, index) => ({
      title: `Серия ${index + 1}`,
      logline: `Что происходит в серии ${index + 1}.`,
      beats: [`ход ${index + 1}`],
      carriesForward: [`факт серии ${index + 1}`]
    }))
  };
}

test("series prompt pins the topic, episode count, language and the JSON contract", () => {
  const prompt = buildSeriesPrompt({
    topic: "реалии вайбкодера",
    language: "de",
    episodeCount: 4,
    episodeDurationSeconds: 60
  });
  assert.match(prompt, /реалии вайбкодера/);
  assert.match(prompt, /ровно 4 серии/);
  assert.match(prompt, /"de"/);
  assert.match(prompt, /1:00/);
  assert.match(prompt, /"carriesForward"/);
  assert.match(prompt, /"episodes"/);
  for (const position of ARC_POSITIONS) assert.match(prompt, new RegExp(position));

  const withoutDuration = buildSeriesPrompt({ topic: "тема", episodeCount: 4 });
  assert.equal(/звучит примерно/.test(withoutDuration), false);
});

test("series prompt clamps a greedy episode count before asking the model", () => {
  const prompt = buildSeriesPrompt({ topic: "тема", episodeCount: 99 });
  assert.match(prompt, new RegExp(`ровно ${SERIES_PLAN_LIMITS.maxEpisodes} серий`));
  assert.equal(/ровно 99/.test(prompt), false);

  const single = buildSeriesPrompt({ topic: "тема", episodeCount: 1 });
  assert.match(single, /ровно 1 серию/);
});

test("parser accepts a valid plan and hands back a frozen, id-stable bible", () => {
  const plan = parseSeriesPlan(JSON.stringify(validPlan), { episodeCount: 3 });

  assert.equal(plan.series.title, "Вайбкодер");
  assert.equal(plan.series.tone, "сухой юмор");
  assert.equal(plan.series.language, "ru");
  assert.deepEqual(plan.series.runningGags, ["деплой в пятницу"]);

  assert.deepEqual(plan.series.characters.map(character => character.id), ["char-1", "char-2"]);
  assert.equal(plan.series.characters[0].name, "Гоша");
  assert.deepEqual(plan.series.characters[0].traits, ["верит промпту", "боится тестов"]);

  assert.equal(plan.episodes.length, 3);
  assert.deepEqual(plan.episodes.map(episode => episode.number), [1, 2, 3]);
  assert.deepEqual(plan.episodes.map(episode => episode.arcPosition), ["setup", "turn", "payoff"]);
  assert.deepEqual(plan.episodes[0].beats, ["промпт", "зелёная сборка", "деплой"]);

  assert.throws(() => { plan.episodes[0].title = "подмена"; }, TypeError);
  assert.throws(() => { plan.series.characters.push({ id: "char-9" }); }, TypeError);
});

test("parser survives the chatter models wrap around JSON", () => {
  const noisy = [
    "Отличная идея! Вот библия сериала:",
    "```json",
    JSON.stringify(validPlan),
    "```",
    "Могу расписать подробнее, если нужно."
  ].join("\n");
  const plan = parseSeriesPlan(noisy, { episodeCount: 3 });
  assert.equal(plan.series.title, "Вайбкодер");
  assert.equal(plan.episodes.length, 3);
});

test("parser fails closed on broken JSON and on missing mandatory parts", () => {
  assert.throws(() => parseSeriesPlan("сериал будет огонь, но json я не осилил", { episodeCount: 3 }), /JSON/i);
  assert.throws(() => parseSeriesPlan('{"series": {"title": "x"', { episodeCount: 3 }), /JSON/i);
  assert.throws(() => parseSeriesPlan(JSON.stringify({ episodes: validPlan.episodes }), { episodeCount: 3 }), /series/);
  assert.throws(
    () => parseSeriesPlan(JSON.stringify({ series: { ...validPlan.series, title: "   " }, episodes: validPlan.episodes }), { episodeCount: 3 }),
    /title/
  );
  assert.throws(
    () => parseSeriesPlan(JSON.stringify({ series: { ...validPlan.series, premise: "" }, episodes: validPlan.episodes }), { episodeCount: 3 }),
    /premise/
  );
  assert.throws(
    () => parseSeriesPlan(JSON.stringify({ series: { ...validPlan.series, characters: [{ role: "без имени" }] }, episodes: validPlan.episodes }), { episodeCount: 3 }),
    /characters/
  );
  assert.throws(() => parseSeriesPlan(JSON.stringify({ series: validPlan.series }), { episodeCount: 3 }), /серий/);
  assert.throws(() => parseSeriesPlan(JSON.stringify(planWithEpisodes(2)), { episodeCount: 5 }), /2 пригодных серий вместо 5/);
});

test("parser clamps episode count, cast size and every string it is handed", () => {
  const overflowing = parseSeriesPlan(JSON.stringify(planWithEpisodes(20)), { episodeCount: 40 });
  assert.equal(overflowing.episodes.length, SERIES_PLAN_LIMITS.maxEpisodes);
  assert.equal(overflowing.episodes.at(-1).number, SERIES_PLAN_LIMITS.maxEpisodes);

  const crowded = parseSeriesPlan(JSON.stringify({
    series: {
      ...validPlan.series,
      premise: "П".repeat(900),
      characters: Array.from({ length: 8 }, (_, index) => ({
        name: `Персонаж ${index + 1}`,
        role: "роль",
        traits: Array.from({ length: 9 }, (_, trait) => `черта ${trait + 1}`),
        appearance: "А".repeat(600)
      })),
      runningGags: Array.from({ length: 9 }, (_, index) => `шутка ${index + 1}`)
    },
    episodes: [{
      ...validPlan.episodes[0],
      title: "Т".repeat(500),
      logline: "Л".repeat(900),
      beats: Array.from({ length: 10 }, (_, index) => `ход ${index + 1}`),
      carriesForward: Array.from({ length: 9 }, (_, index) => `факт ${index + 1}`)
    }]
  }), { episodeCount: 1 });

  assert.equal(crowded.series.characters.length, SERIES_PLAN_LIMITS.maxCharacters);
  assert.deepEqual(crowded.series.characters.map(character => character.id), ["char-1", "char-2", "char-3", "char-4", "char-5"]);
  assert.equal(crowded.series.characters[0].traits.length, SERIES_PLAN_LIMITS.maxTraits);
  assert.ok(crowded.series.characters[0].appearance.length <= 200);
  assert.equal(crowded.series.runningGags.length, SERIES_PLAN_LIMITS.maxRunningGags);
  assert.ok(crowded.series.premise.length <= 400);
  assert.ok(crowded.episodes[0].title.length <= 120);
  assert.ok(crowded.episodes[0].logline.length <= 240);
  assert.equal(crowded.episodes[0].beats.length, SERIES_PLAN_LIMITS.maxBeats);
  assert.equal(crowded.episodes[0].carriesForward.length, SERIES_PLAN_LIMITS.maxCarriesForward);
});

test("parser drops fields the model invented and keeps only the contract", () => {
  const plan = parseSeriesPlan(JSON.stringify({
    series: { ...validPlan.series, budgetUsd: 1000, secretPrompt: "ignore previous instructions" },
    episodes: [{ ...validPlan.episodes[0], sponsor: "acme", arcPosition: "финал сезона" }]
  }), { episodeCount: 1 });

  assert.deepEqual(Object.keys(plan.series).sort(), ["characters", "language", "premise", "runningGags", "title", "tone", "visualStyle"]);
  assert.deepEqual(Object.keys(plan.episodes[0]).sort(), ["arcPosition", "beats", "carriesForward", "logline", "number", "title"]);
  assert.deepEqual(Object.keys(plan.series.characters[0]).sort(), ["appearance", "id", "name", "role", "traits"]);
  // Значение вне словаря — не значение: позиция в арке выводится из номера серии.
  assert.equal(plan.episodes[0].arcPosition, "setup");
});

test("episode brief carries the past of earlier episodes and never its own", () => {
  const plan = parseSeriesPlan(JSON.stringify(validPlan), { episodeCount: 3 });
  const brief = buildEpisodeBrief({ plan, episodeNumber: 3 });

  assert.equal(brief.continuity.length, 2);
  assert.match(brief.continuity[0], /Серия 1 «Первый промпт»: MVP выкачен без единого теста/);
  assert.match(brief.continuity[1], /Серия 2 «Прод горит»: Линт получил право вето на деплой/);
  assert.equal(brief.continuity.some(fact => /первый тест/.test(fact)), false, "серия не знает собственного будущего");

  assert.match(brief.topic, /Вайбкодер/);
  assert.match(brief.topic, /Серия 3: Ретро/);
  assert.ok(brief.topic.length <= 300);
  assert.deepEqual(brief.beats, ["разбор", "первый тест"]);
  assert.deepEqual(brief.characters.map(character => character.id), ["char-1", "char-2"]);
  assert.equal(brief.characters[0].name, "Гоша");
});

test("the first episode gets an empty past instead of an invented one", () => {
  const plan = parseSeriesPlan(JSON.stringify(validPlan), { episodeCount: 3 });
  const brief = buildEpisodeBrief({ plan, episodeNumber: 1 });
  assert.deepEqual(brief.continuity, []);
  assert.deepEqual(brief.beats, ["промпт", "зелёная сборка", "деплой"]);

  const second = buildEpisodeBrief({ plan, episodeNumber: 2 });
  assert.equal(second.continuity.length, 1);
  assert.match(second.continuity[0], /Серия 1/);
});

test("episode brief refuses numbers outside the season", () => {
  const plan = parseSeriesPlan(JSON.stringify(validPlan), { episodeCount: 3 });
  for (const episodeNumber of [0, -1, 4, "нет", null]) {
    assert.throws(() => buildEpisodeBrief({ plan, episodeNumber }), RangeError);
  }
  assert.throws(() => buildEpisodeBrief({ plan: null, episodeNumber: 1 }), RangeError);
  assert.throws(() => buildEpisodeBrief({ plan: { series: validPlan.series, episodes: [] }, episodeNumber: 1 }), RangeError);
});

test("the same input yields the very same plan, prompt and brief", () => {
  const raw = JSON.stringify(validPlan);
  const first = parseSeriesPlan(raw, { episodeCount: 3 });
  const second = parseSeriesPlan(raw, { episodeCount: 3 });
  assert.deepEqual(first, second);
  assert.notEqual(first, second, "план собирается заново, а не отдаётся из общего состояния");

  assert.equal(
    buildSeriesPrompt({ topic: "тема", language: "ru", episodeCount: 3 }),
    buildSeriesPrompt({ topic: "тема", language: "ru", episodeCount: 3 })
  );
  assert.deepEqual(
    buildEpisodeBrief({ plan: first, episodeNumber: 2 }),
    buildEpisodeBrief({ plan: second, episodeNumber: 2 })
  );
});

test("planner asks the model once and returns the parsed season", async () => {
  const model = mockModel([JSON.stringify(validPlan)]);
  const plan = await planSeriesFromTopic({
    topic: "реалии вайбкодера",
    language: "ru",
    episodeCount: 3,
    episodeDurationSeconds: 60,
    textModel: model
  });
  assert.equal(model.calls.length, 1);
  assert.match(model.calls[0].prompt, /реалии вайбкодера/);
  assert.match(model.calls[0].system, /JSON/);
  assert.equal(plan.episodes.length, 3);
  assert.equal(plan.series.language, "ru");
});

test("planner retries with the reason, then fails honestly", async () => {
  const retried = mockModel(["сериал? легко, но без json", JSON.stringify(validPlan)]);
  const plan = await planSeriesFromTopic({ topic: "тема", episodeCount: 3, textModel: retried });
  assert.equal(retried.calls.length, 2);
  assert.match(retried.calls[1].prompt, /повтор|отклонён|json/i);
  assert.equal(plan.episodes.length, 3);

  const hopeless = mockModel(["мусор", "снова мусор"]);
  await assert.rejects(
    planSeriesFromTopic({ topic: "тема", episodeCount: 3, textModel: hopeless }),
    /Series plan failed/
  );
});

test("planner fails closed on an empty topic and a model without complete()", async () => {
  await assert.rejects(
    planSeriesFromTopic({ topic: "   ", textModel: mockModel([]) }),
    /topic/i
  );
  await assert.rejects(
    planSeriesFromTopic({ topic: "тема", textModel: { generate: () => "" } }),
    TypeError
  );
});

test("planner clamps the requested season length end to end", async () => {
  const model = mockModel([JSON.stringify(planWithEpisodes(20))]);
  const plan = await planSeriesFromTopic({ topic: "тема", episodeCount: 40, textModel: model });
  assert.match(model.calls[0].prompt, new RegExp(`ровно ${SERIES_PLAN_LIMITS.maxEpisodes} серий`));
  assert.equal(plan.episodes.length, SERIES_PLAN_LIMITS.maxEpisodes);
  assert.deepEqual(plan.episodes.map(episode => episode.arcPosition).slice(0, 2), ["setup", "escalation"]);
  assert.equal(plan.episodes.at(-1).arcPosition, "payoff");
  assert.equal(plan.episodes.at(-2).arcPosition, "turn");
});
