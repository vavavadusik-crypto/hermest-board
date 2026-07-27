// Правка доски словами. Операции модели — недоверенный вход: применяется только
// то, что прошло проверку, а отказ виден человеку, а не съеден молча.

import assert from "node:assert/strict";
import test from "node:test";

import { applyBoardOperations, applyBoardRequest, buildBoardCommandPrompt } from "../../src/domain/board-commands.js";

function board() {
  return {
    schemaVersion: 1,
    title: "Подписки на ИИ",
    brief: { topic: "как не переплачивать за подписки", language: "ru", voice: "", narrationProvider: "" },
    cards: [
      { id: "scene-01", x: 80, y: 80, title: "Проблема", text: "Подписок много, счёт растёт." },
      { id: "scene-02", x: 500, y: 80, title: "Причина", text: "Их никто не считает." },
      { id: "scene-03", x: 920, y: 80, title: "Решение", text: "Свести всё в один список." }
    ]
  };
}

function modelReturning(...replies) {
  const queue = [...replies];
  const calls = [];
  return { calls, async complete({ prompt }) { calls.push(prompt); return queue.length > 1 ? queue.shift() : queue[0]; } };
}

test("the prompt shows the model what is on the board right now", () => {
  const prompt = buildBoardCommandPrompt({ board: board(), request: "убери вторую карточку" });
  assert.match(prompt, /scene-01: «Проблема»/u);
  assert.match(prompt, /scene-03: «Решение»/u);
  assert.match(prompt, /убери вторую карточку/u);
  assert.match(prompt, /remove_card/u);
});

test("editing a card touches that card and nothing else", () => {
  const before = board();
  const { board: after, applied } = applyBoardOperations({
    board: before,
    operations: [{ op: "update_card", id: "scene-02", text: "Их никто не считает — и они копятся." }]
  });
  assert.deepEqual(applied, ["update_card"]);
  assert.equal(after.cards[1].text, "Их никто не считает — и они копятся.");
  assert.equal(after.cards[1].title, "Причина", "заголовок не просили менять");
  assert.equal(after.cards[0].text, before.cards[0].text);
  assert.equal(after.cards.length, 3);
});

test("a card can be added after a named one and the grid stays readable", () => {
  const { board: after } = applyBoardOperations({
    board: board(),
    operations: [{ op: "add_card", after: "scene-01", title: "Пример", text: "Пять сервисов по 20 долларов." }]
  });
  assert.equal(after.cards.length, 4);
  assert.equal(after.cards[1].title, "Пример");
  assert.equal(after.cards[1].id, "scene-04", "новый id не должен совпасть с существующим");
  // Позиции — производные от порядка, а не то, что пришло извне.
  assert.deepEqual(after.cards.map(card => card.x), [80, 500, 920, 80]);
  assert.deepEqual(after.cards.map(card => card.y), [80, 80, 80, 340]);
});

test("removing the last remaining card is refused", () => {
  const single = { ...board(), cards: [board().cards[0]] };
  assert.throws(
    () => applyBoardOperations({ board: single, operations: [{ op: "remove_card", id: "scene-01" }] }),
    /последнюю карточку/u
  );
});

test("a reorder must be a permutation, not a way to drop cards", () => {
  assert.throws(
    () => applyBoardOperations({ board: board(), operations: [{ op: "reorder_cards", order: ["scene-03", "scene-01"] }] }),
    /ровно один раз/u
  );
  assert.throws(
    () => applyBoardOperations({ board: board(), operations: [{ op: "reorder_cards", order: ["scene-01", "scene-01", "scene-02"] }] }),
    /ровно один раз/u
  );
  const { board: after } = applyBoardOperations({
    board: board(),
    operations: [{ op: "reorder_cards", order: ["scene-03", "scene-01", "scene-02"] }]
  });
  assert.deepEqual(after.cards.map(card => card.id), ["scene-03", "scene-01", "scene-02"]);
});

test("only declared brief fields are editable", () => {
  const { board: after } = applyBoardOperations({
    board: board(), operations: [{ op: "set_brief", field: "tone", value: "ироничный" }]
  });
  assert.equal(after.brief.tone, "ироничный");
  assert.throws(
    () => applyBoardOperations({ board: board(), operations: [{ op: "set_brief", field: "narrationProvider", value: "elevenlabs" }] }),
    /править нельзя/u
  );
});

test("a bad operation is reported, and the good ones still land", () => {
  const { board: after, applied, rejected } = applyBoardOperations({
    board: board(),
    operations: [
      { op: "update_card", id: "scene-99", text: "не существует" },
      { op: "set_title", title: "Подписки: как не переплачивать" }
    ]
  });
  assert.deepEqual(applied, ["set_title"]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /scene-99/u);
  assert.equal(after.title, "Подписки: как не переплачивать");
});

test("an unknown operation cannot reach the board", () => {
  assert.throws(
    () => applyBoardOperations({ board: board(), operations: [{ op: "drop_database" }] }),
    /неизвестная операция/u
  );
});

test("an empty operation list is a named failure, not a silent no-op", () => {
  assert.throws(() => applyBoardOperations({ board: board(), operations: [] }), /ни одной операции/u);
});

test("a request goes through the model and comes back applied", async () => {
  const reply = JSON.stringify({
    summary: "Убрал вторую карточку",
    operations: [{ op: "remove_card", id: "scene-02" }]
  });
  const model = modelReturning(reply);
  const result = await applyBoardRequest({ board: board(), request: "убери вторую карточку", textModel: model });
  assert.equal(result.board.cards.length, 2);
  assert.deepEqual(result.board.cards.map(card => card.id), ["scene-01", "scene-03"]);
  assert.equal(result.summary, "Убрал вторую карточку");
  assert.match(model.calls[0], /убери вторую карточку/u);
});

test("a model answering with prose is retried, then refused", async () => {
  const model = modelReturning("Конечно! Я уберу вторую карточку.");
  await assert.rejects(
    () => applyBoardRequest({ board: board(), request: "убери вторую", textModel: model, maxAttempts: 2 }),
    /не является JSON/u
  );
  assert.equal(model.calls.length, 2, "вторая попытка должна была случиться");
  assert.match(model.calls[1], /Повтор: предыдущий ответ отклонён/u);
});

test("an edit that would break rendering is refused whole", () => {
  // Пустой текст ломает раскадровку, поэтому операция не проходит и доска цела.
  assert.throws(
    () => applyBoardOperations({ board: board(), operations: [{ op: "update_card", id: "scene-01", text: "   " }] }),
    /пустой текст/iu
  );
});

test("hostile operation payloads are clamped, not trusted", () => {
  const { board: after } = applyBoardOperations({
    board: board(),
    operations: [{ op: "update_card", id: "scene-01", title: "Я".repeat(4000), text: "Т".repeat(4000) }]
  });
  assert.ok(after.cards[0].title.length <= 120);
  assert.ok(after.cards[0].text.length <= 600);
});
