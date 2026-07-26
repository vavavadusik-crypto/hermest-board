// Сериал и мультрежим вместе: план сезона задаёт труппу и прошлое, режиссёр
// снимает по ним серию. Преемственность здесь — данные, а не память модели,
// поэтому проверяется тем, что реально доехало до промпта и до карточек.

import assert from "node:assert/strict";
import test from "node:test";

import { buildDirectorPrompt, draftBoardFromTopic } from "../../src/domain/ai-director.js";
import { buildEpisodeBrief, parseSeriesPlan } from "../../src/domain/series-plan.js";

const SEASON = {
  series: {
    title: "Жизнь вайб-кодера",
    premise: "Марк пишет код настроением, Лена держит прод.",
    tone: "тёплая ирония",
    language: "ru",
    characters: [
      { name: "Марк", role: "вайб-кодер", traits: ["оптимист", "не пишет тесты"] },
      { name: "Лена", role: "тимлид", traits: ["спокойная"] }
    ],
    runningGags: ["«с понедельника пишу тесты»"]
  },
  episodes: [
    { number: 1, title: "Пятница деплоя", logline: "Марк катит в прод перед выходными.", beats: ["Марк жмёт deploy"], carriesForward: ["Марк выкатил непроверенный релиз"] },
    { number: 2, title: "Понедельник", logline: "Прод лежит.", beats: ["Лена показывает графики"], carriesForward: ["Лена ввела обязательный код-ревью"] },
    { number: 3, title: "Ретро", logline: "Команда ищет виноватого.", beats: ["Ретро без обвинений"], carriesForward: [] }
  ]
};

function troupeOf(plan) {
  return plan.series.characters.map(character => ({ id: character.id, name: character.name, role: character.role, traits: character.traits }));
}

function modelReturning(reply) {
  const calls = [];
  return { calls, async complete({ prompt }) { calls.push(prompt); return reply; } };
}

test("an episode prompt carries the troupe and what already happened", () => {
  const plan = parseSeriesPlan(JSON.stringify(SEASON), { episodeCount: 3 });
  const brief = buildEpisodeBrief({ plan, episodeNumber: 3 });
  const prompt = buildDirectorPrompt({
    topic: brief.topic, sceneCount: 3, cartoon: true,
    characters: brief.characters, continuity: brief.continuity, beats: brief.beats
  });

  assert.match(prompt, /char-1: Марк/u);
  assert.match(prompt, /char-2: Лена/u);
  assert.match(prompt, /Серия 1 «Пятница деплоя»: Марк выкатил непроверенный релиз/u);
  assert.match(prompt, /Серия 2 «Понедельник»: Лена ввела обязательный код-ревью/u);
  assert.match(prompt, /Ретро без обвинений/u);
  // Труппа задана — модель не должна изобретать свою.
  assert.match(prompt, /верни её в поле cast без изменений/u);
  assert.ok(!prompt.includes("Сначала объяви труппу"));
});

test("episode one is told nothing about a past it does not have", () => {
  const plan = parseSeriesPlan(JSON.stringify(SEASON), { episodeCount: 3 });
  const brief = buildEpisodeBrief({ plan, episodeNumber: 1 });
  const prompt = buildDirectorPrompt({
    topic: brief.topic, sceneCount: 3, cartoon: true,
    characters: brief.characters, continuity: brief.continuity, beats: brief.beats
  });
  assert.ok(!prompt.includes("Что уже произошло"));
  assert.match(prompt, /char-1: Марк/u);
});

test("the season troupe overrides whatever cast the model returns", async () => {
  const plan = parseSeriesPlan(JSON.stringify(SEASON), { episodeCount: 3 });
  const brief = buildEpisodeBrief({ plan, episodeNumber: 2 });
  // Модель своевольничает: подменяет и имена, и id.
  const rogue = JSON.stringify({
    title: "С",
    cast: [{ id: "char-9", name: "Незнакомец" }],
    cards: [{ title: "С1", cartoon: { setting: "room", speaker: "char-9", line: "Реплика", with: ["char-2"] } }]
  });
  const board = await draftBoardFromTopic({
    topic: brief.topic, sceneCount: 1, cartoon: true,
    characters: brief.characters, continuity: brief.continuity, beats: brief.beats,
    textModel: modelReturning(rogue)
  });

  const cast = board.cards[0].sceneData.cartoon.cast;
  assert.ok(cast.every(member => ["char-1", "char-2"].includes(member.id)), `чужие id прошли: ${JSON.stringify(cast)}`);
  // Неизвестный говорящий сведён к труппе сезона, а партнёр из труппы остался.
  assert.equal(cast[0].id, "char-1");
  assert.equal(cast[0].name, "Марк");
  assert.equal(cast[1].id, "char-2");
});

test("the same character keeps one identity across episodes", async () => {
  const plan = parseSeriesPlan(JSON.stringify(SEASON), { episodeCount: 3 });
  const script = JSON.stringify({
    title: "С",
    cast: [{ id: "char-1", name: "Марк" }, { id: "char-2", name: "Лена" }],
    cards: [{ title: "С1", cartoon: { setting: "desk", speaker: "char-1", line: "Реплика", with: ["char-2"] } }]
  });
  const ids = [];
  for (const episodeNumber of [1, 2, 3]) {
    const brief = buildEpisodeBrief({ plan, episodeNumber });
    const board = await draftBoardFromTopic({
      topic: brief.topic, sceneCount: 1, cartoon: true,
      characters: brief.characters, continuity: brief.continuity, beats: brief.beats,
      textModel: modelReturning(script)
    });
    ids.push(board.cards[0].sceneData.cartoon.cast.map(member => `${member.id}:${member.name}`).join("|"));
  }
  assert.equal(new Set(ids).size, 1, `состав поплыл между сериями: ${JSON.stringify(ids)}`);
});

test("series context also reaches the plain narrated mode", () => {
  const plan = parseSeriesPlan(JSON.stringify(SEASON), { episodeCount: 3 });
  const brief = buildEpisodeBrief({ plan, episodeNumber: 3 });
  const prompt = buildDirectorPrompt({
    topic: brief.topic, sceneCount: 3,
    continuity: brief.continuity, beats: brief.beats
  });
  assert.match(prompt, /режиссёр коротких обучающих видео/u);
  assert.match(prompt, /Что уже произошло/u);
  assert.match(prompt, /Опорные точки/u);
});

test("hostile series context is clamped before it reaches the prompt", () => {
  const prompt = buildDirectorPrompt({
    topic: "тема", sceneCount: 2, cartoon: true,
    characters: [
      { id: "char-1", name: "И".repeat(200), role: "Р".repeat(400) },
      { id: "char-1", name: "Дубль" },
      { id: "", name: "Безымянный" }
    ],
    continuity: Array.from({ length: 40 }, (_, index) => `факт ${index}`),
    beats: Array.from({ length: 40 }, (_, index) => `бит ${index}`)
  });
  const troupeLines = prompt.split("\n").filter(line => line.startsWith("- char-"));
  assert.equal(troupeLines.length, 1, "дубликат id или безымянный персонаж попал в труппу");
  assert.ok(troupeLines[0].length < 400, "имя и роль не обрезаны");
  assert.ok(prompt.split("\n").filter(line => /^- факт /u.test(line)).length <= 8);
  assert.ok(prompt.split("\n").filter(line => /^\d+\. бит /u.test(line)).length <= 6);
});
