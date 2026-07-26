// Мультрежим режиссёра: тема → сценарий с постоянной труппой → карточки, которые
// рендерятся архетипом cartoon-shot. Ответ модели здесь — недоверенный вход, и
// проверяется он так же, как любой другой: что переживёт нормализацию, то и попадёт
// в борд.

import assert from "node:assert/strict";
import test from "node:test";

import { buildDirectorPrompt, draftBoardFromTopic } from "../../src/domain/ai-director.js";
import { buildStoryboard } from "../../src/domain/content-pipeline.js";
import { deriveSceneContent, pickSceneArchetype } from "../../src/media/scene-content.js";

function modelReturning(...replies) {
  const queue = [...replies];
  const calls = [];
  return {
    calls,
    async complete({ prompt, system, signal }) {
      calls.push({ prompt, system, signal });
      return queue.length > 1 ? queue.shift() : queue[0];
    }
  };
}

const SCREENPLAY = JSON.stringify({
  title: "Жизнь вайб-кодера",
  cast: [
    { id: "char-mark", name: "Марк", role: "вайб-кодер" },
    { id: "char-lena", name: "Лена", role: "тимлид" }
  ],
  cards: [
    {
      title: "Понедельник",
      cartoon: {
        setting: "desk", speaker: "char-mark", pose: "type",
        line: "Тесты я напишу потом. Сейчас главное — чтобы собралось.",
        with: ["char-lena"], withPose: "shrug", caption: "Понедельник. Офис."
      }
    },
    {
      title: "Среда",
      cartoon: {
        setting: "room", speaker: "char-lena", pose: "point",
        line: "Оно собралось. И упало в проде.", with: ["char-mark"], withPose: "facepalm"
      }
    }
  ]
});

test("cartoon prompt asks for a troupe with stable ids and one line per scene", () => {
  const prompt = buildDirectorPrompt({ topic: "жизнь вайб-кодера", sceneCount: 3, cartoon: true });
  assert.match(prompt, /труппу/u);
  assert.match(prompt, /char-1/u);
  assert.match(prompt, /одна реплика одного персонажа/iu);
  assert.match(prompt, /desk, room, street, void/u);
  assert.ok(!prompt.includes("обучающих видео"), "мультрежим не должен просить обучающий формат");
});

test("the plain prompt is untouched by the cartoon branch", () => {
  const prompt = buildDirectorPrompt({ topic: "подписки на ИИ", sceneCount: 4 });
  assert.match(prompt, /режиссёр коротких обучающих видео/u);
  assert.ok(!prompt.includes("труппу"));
});

test("a screenplay becomes cards that the cartoon archetype picks up", async () => {
  const board = await draftBoardFromTopic({
    topic: "жизнь вайб-кодера", sceneCount: 2, cartoon: true, textModel: modelReturning(SCREENPLAY)
  });

  assert.equal(board.cards.length, 2);
  for (const card of board.cards) {
    assert.equal(card.sceneType, "cartoon");
    assert.ok(card.sceneData.cartoon.line);
    // Закадровый текст обязан совпасть с репликой: диктор произносит то, что
    // персонаж говорит в кадре.
    assert.equal(card.text, card.sceneData.cartoon.line);
    const content = deriveSceneContent(card);
    const picked = pickSceneArchetype({ scene: card, sceneIndex: 0, sceneCount: 2, content });
    assert.equal(picked.archetype, "cartoon-shot");
  }

  const first = board.cards[0].sceneData.cartoon;
  assert.equal(first.setting, "desk");
  assert.equal(first.cast[0].id, "char-mark");
  assert.equal(first.cast[0].speaking, true);
  assert.equal(first.cast[1].id, "char-lena");
  assert.equal(first.cast[1].speaking, false);
  assert.equal(first.caption, "Понедельник. Офис.");
  // Тот же персонаж во второй сцене — тот же id, иначе внешность поплывёт.
  assert.equal(board.cards[1].sceneData.cartoon.cast[0].id, "char-lena");
  assert.equal(board.cards[1].sceneData.cartoon.cast[1].id, "char-mark");
});

test("the drafted screenplay survives the render pipeline", async () => {
  const board = await draftBoardFromTopic({
    topic: "жизнь вайб-кодера", sceneCount: 2, cartoon: true, textModel: modelReturning(SCREENPLAY)
  });
  const storyboard = buildStoryboard(board);
  assert.equal(storyboard.scenes.length, 2);
  assert.equal(storyboard.scenes[0].sceneType, "cartoon");
  assert.ok(storyboard.scenes[0].sceneData.cartoon.cast.length);
});

test("a scene naming an unknown speaker falls back to the declared troupe", async () => {
  const payload = JSON.stringify({
    title: "Т", cast: [{ id: "char-1", name: "Марк" }],
    cards: [{ title: "С", cartoon: { setting: "void", speaker: "char-ghost", line: "Реплика" } }]
  });
  const board = await draftBoardFromTopic({
    topic: "тема", sceneCount: 1, cartoon: true, textModel: modelReturning(payload)
  });
  const cast = board.cards[0].sceneData.cartoon.cast;
  assert.equal(cast.length, 1);
  assert.equal(cast[0].id, "char-1");
  assert.equal(cast[0].speaking, true);
});

test("companions outside the troupe and self-pairing are dropped", async () => {
  const payload = JSON.stringify({
    title: "Т", cast: [{ id: "char-1", name: "Марк" }, { id: "char-2", name: "Лена" }],
    cards: [
      { title: "A", cartoon: { setting: "desk", speaker: "char-1", line: "Раз", with: ["char-404"] } },
      { title: "B", cartoon: { setting: "desk", speaker: "char-1", line: "Два", with: ["char-1"] } },
      { title: "C", cartoon: { setting: "desk", speaker: "char-1", line: "Три", with: ["char-2", "char-2"] } }
    ]
  });
  const board = await draftBoardFromTopic({
    topic: "тема", sceneCount: 3, cartoon: true, textModel: modelReturning(payload)
  });
  assert.equal(board.cards[0].sceneData.cartoon.cast.length, 1, "несуществующий партнёр не попадает в кадр");
  assert.equal(board.cards[1].sceneData.cartoon.cast.length, 1, "персонаж не может стоять рядом сам с собой");
  assert.equal(board.cards[2].sceneData.cartoon.cast.length, 2);
});

test("a screenplay without a troupe is rejected instead of inventing one", async () => {
  const payload = JSON.stringify({
    title: "Т", cards: [{ title: "С", cartoon: { setting: "void", line: "Реплика" } }]
  });
  await assert.rejects(
    () => draftBoardFromTopic({ topic: "тема", sceneCount: 1, cartoon: true, textModel: modelReturning(payload), maxAttempts: 1 }),
    /труппу/u
  );
});

test("scenes without a line are dropped, not rendered mute", async () => {
  const payload = JSON.stringify({
    title: "Т", cast: [{ id: "char-1", name: "Марк" }],
    cards: [
      { title: "Немая", cartoon: { setting: "desk", speaker: "char-1", line: "   " } },
      { title: "Со словами", cartoon: { setting: "desk", speaker: "char-1", line: "Есть реплика" } }
    ]
  });
  const board = await draftBoardFromTopic({
    topic: "тема", sceneCount: 2, cartoon: true, textModel: modelReturning(payload)
  });
  assert.equal(board.cards.length, 1);
  assert.equal(board.cards[0].title, "Со словами");
});

test("hostile screenplay fields are clamped, not trusted", async () => {
  const payload = JSON.stringify({
    title: "Т", cast: [{ id: "char-1", name: "Марк" }],
    cards: [{
      title: "С",
      cartoon: {
        setting: "<script>alert(1)</script>", speaker: "char-1", pose: "'; DROP TABLE --",
        line: "Я".repeat(4000), caption: "К".repeat(400)
      }
    }]
  });
  const board = await draftBoardFromTopic({
    topic: "тема", sceneCount: 1, cartoon: true, textModel: modelReturning(payload)
  });
  const scene = board.cards[0].sceneData.cartoon;
  assert.ok(scene.line.length <= 180, `реплика не обрезана: ${scene.line.length}`);
  assert.ok(scene.caption.length <= 28, `подпись не обрезана: ${scene.caption.length}`);
  // Неизвестные setting/pose не попадают в разметку сырыми: нормализация сцены
  // сведёт их к известному значению при рендере.
  const content = deriveSceneContent(board.cards[0]);
  assert.equal(content.data.cartoon.setting, "void");
  assert.equal(content.data.cartoon.cast[0].pose, "idle");
});

test("cartoon mode is off by default", async () => {
  const plain = JSON.stringify({ title: "Т", cards: [{ title: "С", text: "Обычный закадровый текст." }] });
  const board = await draftBoardFromTopic({ topic: "тема", sceneCount: 1, textModel: modelReturning(plain) });
  assert.equal(board.cards[0].sceneType, undefined);
  assert.equal(board.cards[0].sceneData, undefined);
});
