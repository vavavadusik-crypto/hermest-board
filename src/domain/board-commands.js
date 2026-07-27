// Разговор с доской: «сделай пятую сцену короче», «убери вторую карточку»,
// «тон ироничнее». Просьба уходит модели, модель отвечает НЕ новой доской, а
// списком операций над существующей — и вот почему.
//
// Если позволить модели вернуть доску целиком, каждая мелкая правка становится
// полной перезаписью: модель молча теряет карточки, меняет то, о чём не просили,
// и человек не может увидеть, что именно изменилось. Операции же проверяемы
// поштучно, применяются к настоящей доске, и любую из них видно в отчёте.
//
// Domain-слой: ни HTTP, ни DOM — контракт с моделью, валидация и применение.

import { extractJsonPayload } from "./ai-director.js";
import { buildStoryboard } from "./content-pipeline.js";

export const BOARD_OPERATIONS = Object.freeze([
  "set_title",
  "set_brief",
  "update_card",
  "add_card",
  "remove_card",
  "reorder_cards"
]);

export const BOARD_COMMAND_LIMITS = Object.freeze({
  maxOperations: 12,
  maxRequestChars: 500,
  maxTitleChars: 160,
  maxCardTitleChars: 120,
  maxCardTextChars: 600,
  maxCards: 12,
  minCards: 1
});

const EDITABLE_BRIEF_FIELDS = Object.freeze(["topic", "audience", "tone", "language"]);
const MAX_BRIEF_VALUE_CHARS = 300;
const GRID_ORIGIN = 80;
const GRID_STEP_X = 420;
const GRID_STEP_Y = 260;
const GRID_COLUMNS = 3;

export function buildBoardCommandPrompt({ board, request }) {
  const cards = asCards(board).map(card => `- ${card.id}: «${clean(card.title, BOARD_COMMAND_LIMITS.maxCardTitleChars)}» — ${clean(card.text, 160)}`);
  return [
    "Ты редактируешь раскадровку видео по просьбе человека.",
    `Название: «${clean(board?.title, BOARD_COMMAND_LIMITS.maxTitleChars)}».`,
    `Тема: ${clean(board?.brief?.topic, MAX_BRIEF_VALUE_CHARS) || "не задана"}.`,
    "Карточки сейчас:",
    ...cards,
    `Просьба человека: «${clean(request, BOARD_COMMAND_LIMITS.maxRequestChars)}».`,
    "Верни ТОЛЬКО операции, которые выполняют просьбу. Не трогай то, о чём не просили.",
    `Доступные операции: ${BOARD_OPERATIONS.join(", ")}.`,
    "Формы операций:",
    '{"op": "set_title", "title": "новое название"}',
    '{"op": "set_brief", "field": "topic|audience|tone|language", "value": "новое значение"}',
    '{"op": "update_card", "id": "scene-01", "title": "новый заголовок", "text": "новый закадровый текст"}',
    '{"op": "add_card", "title": "заголовок", "text": "закадровый текст", "after": "scene-02"}',
    '{"op": "remove_card", "id": "scene-03"}',
    '{"op": "reorder_cards", "order": ["scene-02", "scene-01"]}',
    "У update_card можно указать только title или только text — второе останется прежним.",
    "Ответь ТОЛЬКО валидным JSON вида:",
    '{"summary": "что именно сделано, одной фразой", "operations": [ ... ]}'
  ].join("\n");
}

/**
 * Просьба → операции → новая доска. Возвращает и доску, и то, что было сделано,
 * и то, что было отклонено: человек должен видеть отказ, а не гадать, почему
 * его просьбу выполнили наполовину.
 */
export async function applyBoardRequest({
  board,
  request,
  textModel,
  maxAttempts = 2,
  signal
}) {
  const cleanRequest = clean(request, BOARD_COMMAND_LIMITS.maxRequestChars);
  if (!cleanRequest) throw new RangeError("Board request is required");
  if (!board || typeof board !== "object" || !Array.isArray(board.cards)) {
    throw new TypeError("applyBoardRequest requires a board with cards");
  }
  if (!textModel || typeof textModel.complete !== "function") {
    throw new TypeError("applyBoardRequest requires a text model with complete()");
  }

  const basePrompt = buildBoardCommandPrompt({ board, request: cleanRequest });
  let lastFailure = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}\n\nПовтор: предыдущий ответ отклонён (${lastFailure}). Верни ТОЛЬКО валидный JSON описанной формы.`;
    const reply = await textModel.complete({
      system: "Ты возвращаешь только валидный JSON по заданной схеме, без markdown и комментариев.",
      prompt,
      signal
    });
    const payload = extractJsonPayload(reply);
    if (!payload) {
      lastFailure = "ответ не является JSON-объектом";
      continue;
    }
    try {
      return applyBoardOperations({ board, operations: payload.operations, summary: payload.summary });
    } catch (error) {
      lastFailure = error.message;
    }
  }
  throw new RangeError(`Board request failed after ${maxAttempts} attempts: ${lastFailure}`);
}

/**
 * Применение операций к доске. Экспортируется отдельно от модели: это чистая
 * функция, и именно она — граница доверия. Что не прошло здесь, до доски не
 * доедет, кто бы операции ни прислал.
 */
export function applyBoardOperations({ board, operations, summary = "" }) {
  const list = Array.isArray(operations) ? operations : [];
  if (!list.length) throw new RangeError("модель не вернула ни одной операции");
  if (list.length > BOARD_COMMAND_LIMITS.maxOperations) {
    throw new RangeError(`операций больше ${BOARD_COMMAND_LIMITS.maxOperations}`);
  }

  let next = {
    ...structuredClone(board),
    cards: asCards(board).map(card => structuredClone(card))
  };
  const applied = [];
  const rejected = [];

  for (const operation of list) {
    const op = clean(operation?.op, 32);
    try {
      switch (op) {
        case "set_title": next = setTitle(next, operation); break;
        case "set_brief": next = setBrief(next, operation); break;
        case "update_card": next = updateCard(next, operation); break;
        case "add_card": next = addCard(next, operation); break;
        case "remove_card": next = removeCard(next, operation); break;
        case "reorder_cards": next = reorderCards(next, operation); break;
        default: throw new RangeError(`неизвестная операция «${op || "без имени"}»`);
      }
      applied.push(op);
    } catch (error) {
      // Одна негодная операция не отменяет остальные: человек просил несколько
      // вещей, и отказ в одной — не повод не делать другие. Но и молчать нельзя.
      rejected.push({ op: op || "unknown", reason: error.message });
    }
  }

  if (!applied.length) {
    throw new RangeError(rejected[0]?.reason || "ни одна операция не применилась");
  }
  next.cards = relayout(next.cards);
  // Единственный критерий годности правки — доска по-прежнему рендерится.
  buildStoryboard(next);
  return { board: next, applied, rejected, summary: clean(summary, 200) };
}

function setTitle(board, operation) {
  const title = clean(operation?.title, BOARD_COMMAND_LIMITS.maxTitleChars);
  if (!title) throw new RangeError("пустое название");
  return { ...board, title };
}

function setBrief(board, operation) {
  const field = clean(operation?.field, 32);
  if (!EDITABLE_BRIEF_FIELDS.includes(field)) {
    throw new RangeError(`поле брифа «${field || "без имени"}» править нельзя`);
  }
  const value = clean(operation?.value, MAX_BRIEF_VALUE_CHARS);
  if (!value) throw new RangeError(`пустое значение для «${field}»`);
  return { ...board, brief: { ...(board.brief ?? {}), [field]: value } };
}

function updateCard(board, operation) {
  const id = clean(operation?.id, 64);
  const index = board.cards.findIndex(card => card.id === id);
  if (index === -1) throw new RangeError(`карточки «${id || "без id"}» на доске нет`);
  const title = operation?.title === undefined ? null : clean(operation.title, BOARD_COMMAND_LIMITS.maxCardTitleChars);
  const text = operation?.text === undefined ? null : clean(operation.text, BOARD_COMMAND_LIMITS.maxCardTextChars);
  if (title === null && text === null) throw new RangeError("update_card без title и text");
  if (title !== null && !title) throw new RangeError("пустой заголовок карточки");
  if (text !== null && !text) throw new RangeError("пустой текст карточки");
  const cards = board.cards.slice();
  cards[index] = {
    ...cards[index],
    ...(title === null ? {} : { title }),
    ...(text === null ? {} : { text })
  };
  return { ...board, cards };
}

function addCard(board, operation) {
  if (board.cards.length >= BOARD_COMMAND_LIMITS.maxCards) {
    throw new RangeError(`на доске уже ${BOARD_COMMAND_LIMITS.maxCards} карточек`);
  }
  const title = clean(operation?.title, BOARD_COMMAND_LIMITS.maxCardTitleChars);
  const text = clean(operation?.text, BOARD_COMMAND_LIMITS.maxCardTextChars);
  if (!title || !text) throw new RangeError("новой карточке нужны и заголовок, и текст");
  const after = clean(operation?.after, 64);
  const at = after ? board.cards.findIndex(card => card.id === after) : board.cards.length - 1;
  if (after && at === -1) throw new RangeError(`карточки «${after}» на доске нет`);
  const cards = board.cards.slice();
  cards.splice(at + 1, 0, { id: nextCardId(board.cards), x: 0, y: 0, title, text });
  return { ...board, cards };
}

function removeCard(board, operation) {
  const id = clean(operation?.id, 64);
  const index = board.cards.findIndex(card => card.id === id);
  if (index === -1) throw new RangeError(`карточки «${id || "без id"}» на доске нет`);
  if (board.cards.length <= BOARD_COMMAND_LIMITS.minCards) {
    throw new RangeError("последнюю карточку удалить нельзя");
  }
  const cards = board.cards.slice();
  cards.splice(index, 1);
  return { ...board, cards };
}

function reorderCards(board, operation) {
  const order = Array.isArray(operation?.order) ? operation.order.map(id => clean(id, 64)) : [];
  const known = new Set(board.cards.map(card => card.id));
  if (order.length !== board.cards.length || new Set(order).size !== order.length
    || order.some(id => !known.has(id))) {
    // Перестановка обязана быть перестановкой: иначе она молча теряет карточки.
    throw new RangeError("порядок должен перечислить каждую карточку доски ровно один раз");
  }
  const byId = new Map(board.cards.map(card => [card.id, card]));
  return { ...board, cards: order.map(id => byId.get(id)) };
}

// Позиции карточек — производные от порядка, а не то, что модель может задать:
// сетка остаётся читаемой после любой правки.
function relayout(cards) {
  return cards.map((card, index) => ({
    ...card,
    x: GRID_ORIGIN + (index % GRID_COLUMNS) * GRID_STEP_X,
    y: GRID_ORIGIN + Math.floor(index / GRID_COLUMNS) * GRID_STEP_Y
  }));
}

function nextCardId(cards) {
  const used = new Set(cards.map(card => card.id));
  for (let index = 1; index <= BOARD_COMMAND_LIMITS.maxCards + 1; index += 1) {
    const id = `scene-${String(index).padStart(2, "0")}`;
    if (!used.has(id)) return id;
  }
  return `scene-${cards.length + 1}`;
}

function asCards(board) {
  return Array.isArray(board?.cards) ? board.cards : [];
}

function clean(value, maxChars) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}
