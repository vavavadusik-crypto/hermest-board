const DEFAULT_WORDS_PER_MINUTE = 150;
const DEFAULT_MIN_SCENE_DURATION_MS = 2000;
const MIN_RECONCILED_SCENE_DURATION_MS = 250;
const DEFAULT_SCENE_PADDING_MS = 400;
const MAX_CARDS = 200;
const MAX_CARD_TEXT_CHARS = 20000;
// Структурная подсказка карточки для композера кадра. Домен проверяет только
// форму и размер: какие имена архетипов существуют, знает слой отрисовки, и
// незнакомое имя там же тихо откатывается на эвристику.
const MAX_SCENE_DATA_CHARS = 4000;
const SCENE_TYPE_PATTERN = /^[a-z][a-z0-9-]{1,39}$/u;
const MAX_TOTAL_NARRATION_CHARS = 100000;
const MAX_STORYBOARD_DURATION_MS = 2 * 60 * 60 * 1000;
const SUPPORTED_BOARD_SCHEMA_VERSIONS = new Set([1, 4]);
const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export function buildStoryboard(board, options = {}) {
  validateBoardShape(board);
  const title = cleanText(board.title) || "Без названия";
  const wordsPerMinute = positiveNumber(options.wordsPerMinute, DEFAULT_WORDS_PER_MINUTE);
  const minSceneDurationMs = positiveNumber(
    options.minSceneDurationMs,
    DEFAULT_MIN_SCENE_DURATION_MS
  );
  const cards = Array.isArray(board.cards) ? board.cards : [];
  if (cards.length > MAX_CARDS) throw new RangeError(`Storyboard card limit is ${MAX_CARDS}`);
  const renderableCards = cards
    .map((card, index) => normalizeCard(card, index))
    .filter(Boolean)
    .sort(compareCards);

  if (renderableCards.length === 0) {
    throw new TypeError("buildStoryboard requires at least one renderable card");
  }
  assertUniqueCardIds(renderableCards);

  const scenes = renderableCards.map((card, sortedIndex) => {
    const narration = joinSentences(card.title, card.text);
    return {
      id: `scene-${card.id}`,
      cardId: card.id,
      order: sortedIndex + 1,
      title: card.title,
      narration,
      // Необязательные поля: карточка без них даёт ровно ту же сцену, что и до
      // появления архетипов.
      ...(card.sceneType ? { sceneType: card.sceneType } : {}),
      ...(card.sceneData ? { sceneData: card.sceneData } : {}),
      durationMs: estimateDurationMs(narration, wordsPerMinute, minSceneDurationMs),
      visual: {
        assetRef: cleanText(card.assetRef) || null,
        image: cleanText(card.image),
        fallbackStyle: "title-card",
        motion: "none"
      },
      sourceRefs: uniqueStrings(card.sourceRefs),
      subtitleMode: "burn_and_sidecar",
      blockers: []
    };
  });
  const narrationChars = scenes.reduce((total, scene) => total + scene.narration.length, 0);
  const estimatedDurationMs = scenes.reduce((total, scene) => total + scene.durationMs, 0);
  if (narrationChars > MAX_TOTAL_NARRATION_CHARS) {
    throw new RangeError(`Storyboard narration limit is ${MAX_TOTAL_NARRATION_CHARS} characters`);
  }
  if (estimatedDurationMs > MAX_STORYBOARD_DURATION_MS) {
    throw new RangeError("Storyboard estimated duration exceeds the two-hour render limit");
  }

  return { schemaVersion: 1, title, scenes };
}

export function buildNarrationScript(storyboard) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  return scenes.map(scene => cleanText(scene?.narration)).filter(Boolean).join("\n\n");
}

export function reconcileStoryboardWithSceneDurations(storyboard, measuredSceneDurationsMs, options = {}) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const paddingMs = nonNegativeInteger(options.paddingMs, DEFAULT_SCENE_PADDING_MS);
  if (
    scenes.length === 0 ||
    !Array.isArray(measuredSceneDurationsMs) ||
    measuredSceneDurationsMs.length !== scenes.length
  ) {
    throw new TypeError("Per-scene reconciliation requires one measured duration per scene");
  }

  const reconciledScenes = scenes.map((scene, index) => {
    const narrationMs = Math.ceil(Number(measuredSceneDurationsMs[index]));
    if (!Number.isFinite(narrationMs) || narrationMs <= 0) {
      throw new TypeError(`Scene ${scene?.id || index + 1} requires a positive measured narration duration`);
    }
    return {
      ...scene,
      narrationDurationMs: narrationMs,
      durationMs: Math.max(MIN_RECONCILED_SCENE_DURATION_MS, narrationMs + paddingMs)
    };
  });

  return {
    ...storyboard,
    measuredDurationMs: reconciledScenes.reduce((total, scene) => total + scene.durationMs, 0),
    scenes: reconciledScenes
  };
}

function normalizeCard(card, index) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const title = cleanText(card.title);
  const text = cleanText(card.text);
  if (title.length + text.length > MAX_CARD_TEXT_CHARS) {
    throw new RangeError(`Storyboard card text limit is ${MAX_CARD_TEXT_CHARS} characters`);
  }
  if (!title && !text) return null;
  return {
    ...card,
    id: safeId(card.id, index),
    title: title || `Сцена ${index + 1}`,
    text,
    // Нормализованные значения затирают сырые из спреда: в сцену не должно
    // попасть ничего, что не прошло проверку формы и размера.
    sceneType: normalizeSceneType(card.sceneType),
    sceneData: normalizeSceneData(card.sceneData),
    x: finiteNumber(card.x),
    y: finiteNumber(card.y)
  };
}

function normalizeSceneType(value) {
  if (typeof value !== "string") return "";
  const type = value.trim().toLowerCase().replaceAll("_", "-");
  return SCENE_TYPE_PATTERN.test(type) ? type : "";
}

/**
 * Структура кадра, заданная автором карточки. Домен не знает её словаря, но
 * обязан ограничить объём: раскадровка уходит в хранилище и в манифест.
 */
function normalizeSceneData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("Card sceneData must be serialisable JSON");
  }
  if (typeof serialized !== "string") return null;
  if (serialized.length > MAX_SCENE_DATA_CHARS) {
    throw new RangeError(`Card sceneData limit is ${MAX_SCENE_DATA_CHARS} characters`);
  }
  return JSON.parse(serialized);
}

function compareCards(left, right) {
  return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);
}

function estimateDurationMs(text, wordsPerMinute, minimum) {
  const words = cleanText(text).split(/\s+/u).filter(Boolean).length;
  return Math.max(minimum, Math.ceil((words / wordsPerMinute) * 60000));
}

function joinSentences(title, text) {
  return [title, text].filter(Boolean).map(sentence).join(" ");
}

function sentence(value) {
  const text = cleanText(value);
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  if (UNSAFE_CONTROL_CHARACTERS.test(value)) {
    throw new TypeError("Board text contains unsupported control characters");
  }
  return value.trim().replace(/\s+/gu, " ");
}

function validateBoardShape(board) {
  if (!board || typeof board !== "object" || Array.isArray(board)) {
    throw new TypeError("Board project must be an object");
  }
  if (board.schemaVersion !== undefined && !SUPPORTED_BOARD_SCHEMA_VERSIONS.has(Number(board.schemaVersion))) {
    throw new RangeError(`Unsupported board schemaVersion: ${board.schemaVersion}`);
  }
}

function assertUniqueCardIds(cards) {
  const seen = new Set();
  for (const card of cards) {
    if (seen.has(card.id)) throw new TypeError(`Storyboard normalized card id collision: ${card.id}`);
    seen.add(card.id);
  }
}

function safeId(value, index) {
  const id = cleanText(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || `card-${index + 1}`;
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(cleanText).filter(Boolean))];
}
