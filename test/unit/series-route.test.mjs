// HTTP-грань сезона: план сериала заказывается по теме, а серия снимается по
// плану. Тело запроса — недоверенный вход, поэтому проверяется не только
// счастливый путь, но и то, что кривой запрос отбивается кодом, а не стектрейсом.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createLocalMediaJobManager } from "../../src/local-media/job-manager.js";
import { createLocalMediaRequestHandler } from "../../src/local-media/vite-plugin.js";

const SEASON = {
  series: {
    title: "Жизнь вайб-кодера",
    premise: "Марк пишет код настроением, Лена держит прод.",
    tone: "тёплая ирония",
    language: "ru",
    characters: [{ name: "Марк", role: "вайб-кодер" }, { name: "Лена", role: "тимлид" }],
    runningGags: ["«с понедельника пишу тесты»"]
  },
  episodes: [
    { number: 1, title: "Пятница деплоя", logline: "Марк катит в прод.", beats: ["Марк жмёт deploy"], carriesForward: ["Марк выкатил непроверенный релиз"] },
    { number: 2, title: "Понедельник", logline: "Прод лежит.", beats: ["Лена показывает графики"], carriesForward: [] }
  ]
};

async function startServer(t, { planSeries } = {}) {
  const manager = createLocalMediaJobManager({ executeRender: async () => ({}) });
  const server = createServer(createLocalMediaRequestHandler({
    manager,
    ...(planSeries ? { planSeries } : {})
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function startServerWith(t, overrides) {
  const manager = createLocalMediaJobManager({ executeRender: async () => ({}) });
  const server = createServer(createLocalMediaRequestHandler({ manager, ...overrides }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function postSeries(origin, body) {
  return fetch(`${origin}/api/local-media/series`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
    body: JSON.stringify(body)
  });
}

test("a season is planned from a topic and comes back with per-episode briefs", async t => {
  const seen = [];
  const origin = await startServer(t, {
    planSeries: async params => {
      seen.push(params);
      const { planSeriesService } = await import("../../src/local-media/series-service.js");
      return planSeriesService({
        ...params,
        textModel: { async complete() { return JSON.stringify(SEASON); } },
        availabilityCheck: async () => ({ status: "executable" })
      });
    }
  });

  const response = await postSeries(origin, { topic: "жизнь вайб-кодера", episodeCount: 2 });
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.equal(payload.plan.episodes.length, 2);
  assert.equal(seen[0].topic, "жизнь вайб-кодера");

  // Серия 2 несёт то, что передала первая; серия 1 не получает выдуманного прошлого.
  assert.deepEqual(payload.plan.episodes[0].brief.continuity, []);
  assert.match(payload.plan.episodes[1].brief.continuity[0], /Марк выкатил непроверенный релиз/u);
  // Труппа с постоянными id — то, на чём держится единая внешность сезона.
  assert.deepEqual(payload.plan.episodes[0].brief.characters.map(c => c.id), ["char-1", "char-2"]);
});

test("a season request without a topic is refused by code, not by stack trace", async t => {
  const origin = await startServer(t, { planSeries: async () => assert.fail("сервис не должен вызываться") });
  const response = await postSeries(origin, { episodeCount: 3 });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "series_topic_required");
});

test("a non-numeric episode count is refused", async t => {
  const origin = await startServer(t, { planSeries: async () => assert.fail("сервис не должен вызываться") });
  const response = await postSeries(origin, { topic: "тема", episodeCount: "много" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "series_episode_count_invalid");
});

test("a season request without the local-media header is refused", async t => {
  const origin = await startServer(t, { planSeries: async () => assert.fail("сервис не должен вызываться") });
  const response = await fetch(`${origin}/api/local-media/series`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic: "тема" })
  });
  assert.ok(response.status >= 400, `ожидалась ошибка, получено ${response.status}`);
});

test("asking for an episode without a plan is refused", async t => {
  const origin = await startServer(t);
  const response = await fetch(`${origin}/api/local-media/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
    body: JSON.stringify({ topic: "тема", episodeNumber: 2 })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "draft_series_plan_required");
});

test("a zero or fractional episode number is refused", async t => {
  const origin = await startServer(t);
  for (const episodeNumber of [0, -1, 1.5]) {
    const response = await fetch(`${origin}/api/local-media/draft`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
      body: JSON.stringify({ topic: "тема", episodeNumber, series: SEASON })
    });
    assert.equal(response.status, 400, `номер ${episodeNumber} прошёл`);
    assert.equal((await response.json()).error, "draft_episode_number_invalid");
  }
});

const BOARD = {
  schemaVersion: 1,
  title: "Подписки",
  brief: { topic: "тема", language: "ru" },
  cards: [
    { id: "scene-01", x: 80, y: 80, title: "Проблема", text: "Счёт растёт." },
    { id: "scene-02", x: 500, y: 80, title: "Решение", text: "Свести в список." }
  ]
};

function postCommand(origin, body, headers = { "content-type": "application/json", "x-hermest-local-media": "1" }) {
  return fetch(`${origin}/api/local-media/board-command`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("a board edit request reaches the service and returns what changed", async t => {
  const seen = [];
  const origin = await startServerWith(t, {
    runBoardCommand: async params => {
      seen.push(params);
      const { applyBoardOperations } = await import("../../src/domain/board-commands.js");
      return applyBoardOperations({
        board: params.board,
        operations: [{ op: "remove_card", id: "scene-02" }],
        summary: "Убрал вторую"
      });
    }
  });
  const response = await postCommand(origin, { board: BOARD, request: "убери вторую карточку" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.board.cards.length, 1);
  assert.deepEqual(payload.applied, ["remove_card"]);
  assert.equal(seen[0].request, "убери вторую карточку");
});

test("a board edit without a board or without a request is refused", async t => {
  const origin = await startServerWith(t, { runBoardCommand: async () => assert.fail("сервис не должен вызываться") });
  const noRequest = await postCommand(origin, { board: BOARD });
  assert.equal(noRequest.status, 400);
  assert.equal((await noRequest.json()).error, "board_command_required");

  const noBoard = await postCommand(origin, { request: "убери вторую" });
  assert.equal(noBoard.status, 400);
  assert.equal((await noBoard.json()).error, "board_command_board_required");
});

test("a board edit without the local-media header is refused", async t => {
  const origin = await startServerWith(t, { runBoardCommand: async () => assert.fail("сервис не должен вызываться") });
  const response = await postCommand(origin, { board: BOARD, request: "убери вторую" }, { "content-type": "application/json" });
  assert.ok(response.status >= 400, `ожидалась ошибка, получено ${response.status}`);
});
