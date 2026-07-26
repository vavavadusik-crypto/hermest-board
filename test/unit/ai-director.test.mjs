import assert from "node:assert/strict";
import test from "node:test";

import { draftBoardFromTopic, extractJsonPayload, buildDirectorPrompt } from "../../src/domain/ai-director.js";
import { buildStoryboard } from "../../src/domain/content-pipeline.js";

const validDraft = {
  title: "Квантовые компьютеры простыми словами",
  cards: [
    { title: "Обычные биты", text: "Классический компьютер оперирует нулями и единицами." },
    { title: "Кубиты", text: "Кубит может находиться в суперпозиции состояний." },
    { title: "Запутанность", text: "Связанные кубиты меняют состояние согласованно." }
  ]
};

function mockModel(responses) {
  const calls = [];
  return {
    calls,
    async complete({ system, prompt }) {
      calls.push({ system, prompt });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  };
}

test("director drafts a renderable board from a topic via the text model", async () => {
  const model = mockModel([JSON.stringify(validDraft)]);
  const board = await draftBoardFromTopic({
    topic: "Квантовые компьютеры простыми словами",
    language: "ru",
    sceneCount: 3,
    textModel: model
  });
  assert.equal(board.schemaVersion, 1);
  assert.equal(board.brief.topic, "Квантовые компьютеры простыми словами");
  assert.equal(board.brief.language, "ru");
  assert.equal(board.cards.length, 3);
  for (const card of board.cards) {
    assert.match(card.id, /^[a-z0-9-]+$/);
    assert.equal(typeof card.x, "number");
    assert.equal(typeof card.y, "number");
    assert.ok(card.title.length > 0);
    assert.ok(card.text.length > 0);
  }
  const storyboard = buildStoryboard(board);
  assert.equal(storyboard.scenes.length, 3);
  assert.match(model.calls[0].prompt, /Квантовые компьютеры/);
  assert.match(model.calls[0].prompt, /JSON/);
});

test("director unwraps markdown code fences web chats love to add", () => {
  const fenced = "Вот ваш план:\n```json\n" + JSON.stringify(validDraft) + "\n```\nУдачи!";
  const payload = extractJsonPayload(fenced);
  assert.equal(payload.title, validDraft.title);
  assert.equal(payload.cards.length, 3);
  assert.equal(extractJsonPayload("никакого джейсона тут нет"), null);
});

test("director retries once with the validation error, then fails honestly", async () => {
  const retried = mockModel(["это не json", JSON.stringify(validDraft)]);
  const board = await draftBoardFromTopic({
    topic: "тема",
    textModel: retried,
    sceneCount: 3
  });
  assert.equal(retried.calls.length, 2);
  assert.match(retried.calls[1].prompt, /повтор|ошибк|json/i);
  assert.equal(board.cards.length, 3);

  const hopeless = mockModel(["мусор", "снова мусор"]);
  await assert.rejects(
    draftBoardFromTopic({ topic: "тема", textModel: hopeless, sceneCount: 3 }),
    /draft/i
  );
});

test("director fails closed on empty topics and unusable cards", async () => {
  await assert.rejects(
    draftBoardFromTopic({ topic: "   ", textModel: mockModel([]) }),
    /topic/i
  );
  const emptyCards = mockModel([
    JSON.stringify({ title: "x", cards: [] }),
    JSON.stringify({ title: "x", cards: [] })
  ]);
  await assert.rejects(
    draftBoardFromTopic({ topic: "тема", textModel: emptyCards }),
    /draft/i
  );
});

test("director prompt pins language, scene count and contract", () => {
  const prompt = buildDirectorPrompt({ topic: "Тёмная материя", language: "de", sceneCount: 4 });
  assert.match(prompt, /Тёмная материя/);
  assert.match(prompt, /\bde\b/);
  assert.match(prompt, /4/);
  assert.match(prompt, /"cards"/);
});

const RESEARCH_SOURCES = Object.freeze([
  Object.freeze({ id: "src-wikipedia-1", source: "wikipedia", title: "Quantum computing", url: "https://en.wikipedia.org/wiki/Quantum_computing", snippet: "Computation using quantum phenomena." }),
  Object.freeze({ id: "src-arxiv-1", source: "arxiv", title: "Quantum supremacy", url: "https://arxiv.org/abs/1910.11333", year: 2019 })
]);

test("director prompt carries research sources and demands sourceRefs", () => {
  const prompt = buildDirectorPrompt({
    topic: "Квантовые компьютеры",
    sceneCount: 3,
    sources: RESEARCH_SOURCES
  });
  assert.match(prompt, /src-wikipedia-1/);
  assert.match(prompt, /en\.wikipedia\.org/);
  assert.match(prompt, /sourceRefs/);
  assert.match(prompt, /ТОЛЬКО/i);
});

test("drafted cards keep verified sourceRefs and the board carries sources", async () => {
  const reply = JSON.stringify({
    title: "Квантовые компьютеры простыми словами",
    cards: [
      { title: "Что это", text: "Компьютер на кубитах.", sourceRefs: ["src-wikipedia-1"] },
      { title: "Прорыв", text: "Квантовое превосходство показано в 2019.", sourceRefs: ["src-arxiv-1", "src-fake-99"] },
      { title: "Итог", text: "Технология взрослеет.", sourceRefs: ["src-fake-99"] }
    ]
  });
  const board = await draftBoardFromTopic({
    topic: "Квантовые компьютеры",
    sceneCount: 3,
    textModel: mockModel([reply]),
    sources: RESEARCH_SOURCES
  });

  assert.deepEqual(board.cards[0].sourceRefs, ["src-wikipedia-1"]);
  assert.deepEqual(board.cards[1].sourceRefs, ["src-arxiv-1"], "unknown refs are dropped");
  assert.deepEqual(board.cards[2].sourceRefs, [], "fully unknown refs leave an honest empty list");
  assert.equal(board.sources.length, 2);
  assert.equal(board.sources[0].id, "src-wikipedia-1");
  assert.equal(board.sources[0].url, "https://en.wikipedia.org/wiki/Quantum_computing");
  const withCitations = board.cards.filter(card => card.sourceRefs.length > 0).length;
  assert.ok(withCitations >= 2, "topic must yield cards with working citations");
});

test("director prompt carries an explicit character budget for the target duration", () => {
  const withTarget = buildDirectorPrompt({
    topic: "Подписки на ИИ",
    sceneCount: 6,
    targetDurationSeconds: 60
  });
  assert.match(withTarget, /Ролик должен звучать 1:00\./);
  assert.match(withTarget, /непробельных символов/);

  const withoutTarget = buildDirectorPrompt({ topic: "Подписки на ИИ", sceneCount: 6 });
  assert.equal(/должен звучать/.test(withoutTarget), false);
  assert.equal(/непробельных символов/.test(withoutTarget), false);
});

test("director records the target duration in the brief and rejects hostile values", async () => {
  const model = mockModel([JSON.stringify(validDraft)]);
  const board = await draftBoardFromTopic({
    topic: "Квантовые компьютеры простыми словами",
    sceneCount: 3,
    targetDurationSeconds: 155,
    textModel: model
  });
  assert.equal(board.brief.targetDurationSeconds, 155);

  const withoutTarget = await draftBoardFromTopic({
    topic: "Квантовые компьютеры простыми словами",
    sceneCount: 3,
    textModel: mockModel([JSON.stringify(validDraft)])
  });
  assert.equal("targetDurationSeconds" in withoutTarget.brief, false);

  await assert.rejects(
    draftBoardFromTopic({
      topic: "Квантовые компьютеры простыми словами",
      sceneCount: 3,
      targetDurationSeconds: 5,
      textModel: mockModel([JSON.stringify(validDraft)])
    }),
    RangeError
  );
});
