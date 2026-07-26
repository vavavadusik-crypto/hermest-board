import assert from "node:assert/strict";
import test from "node:test";

import { draftBoardService } from "../../src/local-media/draft-service.js";

const PLAN_JSON = JSON.stringify({
  title: "T",
  cards: [
    { title: "a", text: "aa" },
    { title: "b", text: "bb" }
  ]
});

function mockTextModel() {
  const calls = [];
  return {
    calls,
    async complete({ prompt }) {
      calls.push(prompt);
      return PLAN_JSON;
    }
  };
}

function executableBridge() {
  return async () => ({ status: "executable", provider: "browser-bridge" });
}

function countingResearch(result) {
  const state = { calls: 0 };
  state.search = async query => {
    state.calls += 1;
    state.lastQuery = query;
    if (result instanceof Error) throw result;
    return result;
  };
  return state;
}

test("draft service composes research sources into a renderable board", async () => {
  const research = countingResearch({
    sources: [
      { id: "src-wikipedia-1", source: "wikipedia", title: "Quantum computing", url: "https://en.wikipedia.org/wiki/Quantum_computing" },
      { id: "src-arxiv-1", source: "arxiv", title: "Quantum supremacy", url: "https://arxiv.org/abs/1910.11333", year: 2019 }
    ],
    warnings: ["crossref: timeout"]
  });
  const textModel = mockTextModel();

  const result = await draftBoardService({
    topic: "Квантовые компьютеры простыми словами",
    sceneCount: 2,
    textModel,
    researchSearch: research.search,
    availabilityCheck: executableBridge()
  });

  assert.equal(research.calls, 1);
  assert.equal(research.lastQuery, "Квантовые компьютеры простыми словами");
  assert.ok(result.board.cards.length >= 2);
  assert.equal(result.board.brief.language, "ru");
  assert.equal(result.sources.length, 2);
  assert.ok(Array.isArray(result.warnings));
  assert.deepEqual(result.warnings, ["crossref: timeout"]);
  assert.match(textModel.calls[0], /src-wikipedia-1/);
});

test("draft service skips research entirely when it is disabled", async () => {
  const research = countingResearch({ sources: [], warnings: [] });

  const result = await draftBoardService({
    topic: "Тёмная материя",
    sceneCount: 2,
    research: false,
    textModel: mockTextModel(),
    researchSearch: research.search,
    availabilityCheck: executableBridge()
  });

  assert.equal(research.calls, 0, "disabled research must not hit the network path");
  assert.ok(result.board.cards.length >= 2);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.board.sources, undefined);
});

test("draft service stays fail-open when research blows up", async () => {
  const research = countingResearch(new Error("all providers unreachable"));

  const result = await draftBoardService({
    topic: "Как работает GPS",
    sceneCount: 2,
    textModel: mockTextModel(),
    researchSearch: research.search,
    availabilityCheck: executableBridge()
  });

  assert.equal(research.calls, 1);
  assert.ok(result.board.cards.length >= 2);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /research failed: all providers unreachable/);
});

test("research warnings are sanitized: no absolute paths, stacks or unbounded text", async () => {
  const noisyFailure = new Error(
    `providers died at /home/architect/.secrets/research.js and C:\\Users\\dev\\keys.txt\n    at stackFrame (/home/architect/app.js:1:1)\n${"x".repeat(600)}`
  );
  const failed = await draftBoardService({
    topic: "Как работает GPS",
    sceneCount: 2,
    textModel: mockTextModel(),
    researchSearch: countingResearch(noisyFailure).search,
    availabilityCheck: executableBridge()
  });
  assert.equal(failed.warnings.length, 1);
  assert.match(failed.warnings[0], /^research failed: /);
  assert.equal(failed.warnings[0].includes("/home"), false, "no POSIX paths in warnings");
  assert.equal(failed.warnings[0].includes("C:\\"), false, "no Windows paths in warnings");
  assert.equal(failed.warnings[0].includes("\n"), false, "no multi-line stacks in warnings");
  assert.ok(failed.warnings[0].length <= 300, "warnings are length-capped");

  const noisyProvider = await draftBoardService({
    topic: "Как работает GPS",
    sceneCount: 2,
    textModel: mockTextModel(),
    researchSearch: countingResearch({
      sources: [],
      warnings: ["crossref hiccup at /home/architect/.cache/crossref\n    at frame"]
    }).search,
    availabilityCheck: executableBridge()
  });
  assert.equal(noisyProvider.warnings.length, 1);
  assert.equal(noisyProvider.warnings[0].includes("/home"), false);
  assert.equal(noisyProvider.warnings[0].includes("\n"), false);
});

test("draft service fails closed with 503 when the text bridge is down", async () => {
  const research = countingResearch({ sources: [], warnings: [] });

  await assert.rejects(
    draftBoardService({
      topic: "Любая тема",
      textModel: mockTextModel(),
      researchSearch: research.search,
      availabilityCheck: async () => ({ status: "missing", provider: "browser-bridge", reason: "browser-ai-bridge is not running" })
    }),
    error => {
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /browser-ai-bridge is not running/);
      return true;
    }
  );
  assert.equal(research.calls, 0, "unavailable bridge must short-circuit before research");
});

test("draft service rejects an empty topic before touching any provider", async () => {
  const research = countingResearch({ sources: [], warnings: [] });
  let availabilityCalls = 0;

  await assert.rejects(
    draftBoardService({
      topic: "   ",
      textModel: mockTextModel(),
      researchSearch: research.search,
      availabilityCheck: async () => {
        availabilityCalls += 1;
        return { status: "executable" };
      }
    }),
    TypeError
  );
  assert.equal(availabilityCalls, 0);
  assert.equal(research.calls, 0);
});

// Валидация модели живёт в createBridgeTextModel; здесь проверяем только то,
// что выбранный в UI провайдер вообще доезжает до фабрики модели.
test("draft service passes the selected bridge model down to the text model factory", async () => {
  await assert.rejects(
    draftBoardService({
      topic: "Выбор провайдера",
      sceneCount: 2,
      research: false,
      model: "../evil",
      availabilityCheck: executableBridge()
    }),
    /invalid bridge model/
  );
});

// Прямой OpenAI-совместимый провайдер не должен зависеть от браузерного моста:
// проверка моста в этом режиме не выполняется вовсе.
test("draft service skips the bridge availability check for an openai endpoint", async () => {
  let availabilityCalls = 0;
  const textModel = mockTextModel();

  const result = await draftBoardService({
    topic: "Свой ключ вместо моста",
    sceneCount: 2,
    research: false,
    endpoint: { kind: "openai", baseUrl: "https://x.example/v1", model: "m" },
    textModel,
    availabilityCheck: async () => {
      availabilityCalls += 1;
      return { status: "missing", reason: "bridge is down" };
    }
  });

  assert.equal(availabilityCalls, 0, "openai endpoint must not depend on the browser bridge");
  assert.ok(result.board.cards.length >= 2);
  assert.equal(textModel.calls.length, 1);
});

test("draft service builds the openai text model from the endpoint, not the bridge", async () => {
  await assert.rejects(
    draftBoardService({
      topic: "Небезопасный baseUrl",
      sceneCount: 2,
      research: false,
      endpoint: { kind: "openai", baseUrl: "http://169.254.169.254/v1", model: "m" },
      availabilityCheck: executableBridge()
    }),
    /baseUrl is allowed only for/
  );
});

test("draft service clamps the scene count into the renderable range", async () => {
  const textModel = mockTextModel();

  await draftBoardService({
    topic: "Слишком много сцен",
    sceneCount: 99,
    research: false,
    textModel,
    availabilityCheck: executableBridge()
  });

  assert.match(textModel.calls[0], /ровно 12 сцен/);
});

const promptSceneCount = prompt => Number(/ровно (\d+) сцен/u.exec(prompt)?.[1]);

test("draft service derives the scene count from the requested duration", async () => {
  const longerModel = mockTextModel();
  const longer = await draftBoardService({
    topic: "Подписки на ИИ",
    targetDurationSeconds: 180,
    research: false,
    textModel: longerModel,
    availabilityCheck: executableBridge()
  });

  const shorterModel = mockTextModel();
  const shorter = await draftBoardService({
    topic: "Подписки на ИИ",
    targetDurationSeconds: 30,
    research: false,
    textModel: shorterModel,
    availabilityCheck: executableBridge()
  });

  assert.equal(longer.board.brief.targetDurationSeconds, 180);
  assert.equal(shorter.board.brief.targetDurationSeconds, 30);
  const longerScenes = promptSceneCount(longerModel.calls[0]);
  const shorterScenes = promptSceneCount(shorterModel.calls[0]);
  assert.ok(longerScenes > shorterScenes, `${longerScenes} > ${shorterScenes}`);
  assert.ok(shorterScenes >= 2 && longerScenes <= 12);
});

test("draft service rejects a target duration outside the supported corridor", async () => {
  await assert.rejects(
    draftBoardService({
      topic: "Подписки на ИИ",
      targetDurationSeconds: 5,
      research: false,
      textModel: mockTextModel(),
      availabilityCheck: executableBridge()
    }),
    RangeError
  );
  await assert.rejects(
    draftBoardService({
      topic: "Подписки на ИИ",
      targetDurationSeconds: "минута",
      research: false,
      textModel: mockTextModel(),
      availabilityCheck: executableBridge()
    }),
    TypeError
  );
});

test("an explicit scene count overrides the duration-derived one", async () => {
  const textModel = mockTextModel();
  await draftBoardService({
    topic: "Подписки на ИИ",
    targetDurationSeconds: 600,
    sceneCount: 3,
    research: false,
    textModel,
    availabilityCheck: executableBridge()
  });
  assert.match(textModel.calls[0], /ровно 3 сцен/u);
});

test("without a target duration the draft keeps the previous default scene count", async () => {
  const textModel = mockTextModel();
  const result = await draftBoardService({
    topic: "Подписки на ИИ",
    research: false,
    textModel,
    availabilityCheck: executableBridge()
  });
  assert.match(textModel.calls[0], /ровно 6 сцен/u);
  assert.equal("targetDurationSeconds" in result.board.brief, false);
});

const SCREENPLAY_JSON = JSON.stringify({
  title: "T",
  cast: [{ id: "char-1", name: "Марк" }],
  cards: [
    { title: "a", cartoon: { setting: "desk", speaker: "char-1", line: "Первая реплика" } },
    { title: "b", cartoon: { setting: "room", speaker: "char-1", line: "Вторая реплика" } }
  ]
});

test("the cartoon flag reaches the director and comes back as cartoon cards", async () => {
  const model = { calls: [], async complete({ prompt }) { model.calls.push(prompt); return SCREENPLAY_JSON; } };
  const result = await draftBoardService({
    topic: "жизнь вайб-кодера",
    cartoon: true,
    sceneCount: 2,
    research: false,
    textModel: model,
    availabilityCheck: executableBridge()
  });
  assert.match(model.calls[0], /труппу/u, "режиссёр получил не сценарный промпт");
  for (const card of result.board.cards) {
    assert.equal(card.sceneType, "cartoon");
    assert.ok(card.sceneData.cartoon.cast.length);
  }
});

test("without the flag the draft stays a narrated board", async () => {
  const model = mockTextModel();
  const result = await draftBoardService({
    topic: "подписки на ИИ",
    sceneCount: 2,
    research: false,
    textModel: model,
    availabilityCheck: executableBridge()
  });
  assert.ok(!model.calls[0].includes("труппу"));
  assert.equal(result.board.cards[0].sceneType, undefined);
});
