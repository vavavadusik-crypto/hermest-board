// Содержимое сцены: превращает карточку (заголовок + текст + произвольные поля)
// в структуру, из которой любой архетип соберёт осмысленный кадр, и выбирает
// архетип — явно по `card.sceneType` или эвристикой по содержимому.
//
// Слой чистый: никакого HTML, никаких сторонних эффектов, только детерминированные
// преобразования строк. Экранирование — забота слоя рендера.

import { clampText, pickLeadSentence, sentenceKey, splitSentences } from "./scene-design.js";

export const SCENE_ARCHETYPES = Object.freeze([
  "classic",
  "statement",
  "device-mockup",
  "board-columns",
  "format-trio",
  "checklist",
  "comparison",
  "stat-highlight",
  "flow-steps",
  "quote",
  "metric-grid"
]);

const ARCHETYPE_SET = new Set(SCENE_ARCHETYPES);

// Ротация на случай, когда единственный подходящий архетип совпал с предыдущей
// сценой: ритм важнее «идеального» совпадения, две одинаковые композиции подряд
// и есть то, что выглядит как слайд-шоу.
const NEUTRAL_ROTATION = Object.freeze(["classic", "device-mockup", "statement", "checklist"]);

const MAX_ITEMS = 5;
const MAX_ITEM_CHARS = 64;
const MAX_LABEL_CHARS = 28;

const KEYWORDS = Object.freeze({
  board: /доск|канбан|колонк|бэклог|board|kanban|backlog|в работе|в процессе|готово|воронк|workflow|pipeline/iu,
  formats: /\b(?:16:9|9:16|1:1|4:5)\b|формат|вертикал|горизонтал|квадрат|shorts|reels|tiktok|соотношени|aspect ratio/iu,
  device: /интерфейс|приложени|экран|ноутбук|ноут|телефон|смартфон|браузер|дашборд|dashboard|редактор|laptop|phone|screen|\bui\b|\bапп\b/iu,
  steps: /сначал|затем|потом|шаг \d|этап \d|\bдалее\b|наконец|по порядку|→|->|\bstep \d/iu,
  checklist: /чеклист|checklist|список|пункт|проверь|убедись|галочк|требовани/iu
});

const CONTRAST_RULES = Object.freeze([
  {
    pattern: /\bбыло\b[\s:—–-]*(.{3,120}?)[.;]\s*\bстало\b[\s:—–-]*(.{3,120})$/iu,
    labels: ["Было", "Стало"]
  },
  {
    pattern: /\bраньше\b[\s:—–-]*(.{3,120}?)[.;]\s*\b(?:теперь|сейчас)\b[\s:—–-]*(.{3,120})$/iu,
    labels: ["Раньше", "Теперь"]
  },
  {
    pattern: /\bдо\b[\s:—–-]+(.{3,120}?)[.;]\s*\bпосле\b[\s:—–-]+(.{3,120})$/iu,
    labels: ["До", "После"]
  },
  {
    pattern: /\bbefore\b[\s:—–-]+(.{3,120}?)[.;]\s*\bafter\b[\s:—–-]+(.{3,120})$/iu,
    labels: ["Before", "After"]
  },
  {
    pattern: /(.{3,120}?)\s+вместо\s+(.{3,120})$/iu,
    labels: ["Стало", "Было"],
    swap: true
  },
  {
    pattern: /(.{3,120}?)\s+(?:vs\.?|против)\s+(.{3,120})$/iu,
    labels: ["", ""]
  }
]);

const NUMBER_PATTERN = /(\d{1,3}(?:[  ]\d{3})+|\d+(?:[.,]\d+)?)\s*(%|₽|\$|€|тыс\.?|млн|млрд|раз|мин|сек|час(?:ов|а)?|дней|дня|шт|fps|гб|мб|кб|k|х|x)?/giu;
const QUOTE_PATTERN = /[«"“]([^«»"“”]{8,220})[»"”]/u;
const ATTRIBUTION_PATTERN = /[—–-]\s*([^.;]{2,60})\s*$/u;

export function isSceneArchetype(value) {
  return typeof value === "string" && ARCHETYPE_SET.has(value);
}

function normalizeArchetype(value) {
  const candidate = String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
  return ARCHETYPE_SET.has(candidate) ? candidate : "";
}

// Управляющие символы приходят только из произвольного sceneData: экранирование
// их не тронет, а в разметке они мусор. Убираем до всех прочих чисток.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;

function cleanItem(value, limit = MAX_ITEM_CHARS) {
  const text = String(value ?? "")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .replace(/^[\s,;.:•·—–-]+/u, "")
    .replace(/[\s,;:]+$/u, "")
    .trim();
  return text ? clampText(text, limit) : "";
}

function cleanList(values, { limit = MAX_ITEM_CHARS, max = MAX_ITEMS } = {}) {
  if (!Array.isArray(values)) return [];
  const list = [];
  for (const value of values) {
    const item = cleanItem(value, limit);
    if (item) list.push(item);
    if (list.length >= max) break;
  }
  return list;
}

/** Явные поля карточки: только известные ключи, всё обрезано по длине. */
function normalizeSceneData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const data = {};
  const items = cleanList(raw.items);
  if (items.length) data.items = items;
  const steps = cleanList(raw.steps);
  if (steps.length) data.steps = steps;
  const formats = cleanList(raw.formats, { limit: MAX_LABEL_CHARS, max: 3 });
  if (formats.length) data.formats = formats;
  if (Array.isArray(raw.columns)) {
    const columns = [];
    for (const column of raw.columns.slice(0, 4)) {
      const title = cleanItem(column?.title, MAX_LABEL_CHARS);
      const cards = cleanList(column?.cards, { limit: 40, max: 4 });
      if (title || cards.length) columns.push({ title, cards });
    }
    if (columns.length) data.columns = columns;
  }
  if (raw.stat && typeof raw.stat === "object" && !Array.isArray(raw.stat)) {
    const value = cleanItem(raw.stat.value, 12);
    if (value) {
      data.stat = {
        value,
        unit: cleanItem(raw.stat.unit, 8),
        caption: cleanItem(raw.stat.caption, 72)
      };
    }
  }
  if (raw.compare && typeof raw.compare === "object" && !Array.isArray(raw.compare)) {
    const left = normalizeComparisonSide(raw.compare.left);
    const right = normalizeComparisonSide(raw.compare.right);
    if (left && right) data.compare = { left, right };
  }
  if (raw.device && typeof raw.device === "object" && !Array.isArray(raw.device)) {
    const kind = String(raw.device.kind ?? "").trim().toLowerCase();
    data.device = {
      kind: kind === "phone" ? "phone" : "laptop",
      title: cleanItem(raw.device.title, MAX_LABEL_CHARS),
      lines: cleanList(raw.device.lines, { limit: 40, max: 4 })
    };
  }
  if (raw.quote && typeof raw.quote === "object" && !Array.isArray(raw.quote)) {
    const text = cleanItem(raw.quote.text, 220);
    if (text) data.quote = { text, source: cleanItem(raw.quote.source, 48) };
  }
  const cta = cleanItem(raw.cta, MAX_LABEL_CHARS);
  if (cta) data.cta = cta;
  return data;
}

function normalizeComparisonSide(side) {
  if (!side || typeof side !== "object" || Array.isArray(side)) return null;
  const label = cleanItem(side.label, MAX_LABEL_CHARS);
  const text = cleanItem(side.text, 96);
  const items = cleanList(side.items, { limit: 48, max: 4 });
  if (!label && !text && !items.length) return null;
  return { label, text, items };
}

/** Числа из текста: значение, единица и признак «целое» (для набегающего счётчика). */
function extractNumbers(text) {
  const numbers = [];
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(NUMBER_PATTERN)) {
    const rawValue = match[1].replace(/[  ]/gu, "");
    const unit = cleanItem(match[2], 8);
    const key = `${rawValue}|${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const numeric = Number(rawValue.replace(",", "."));
    numbers.push({
      raw: rawValue,
      unit,
      value: Number.isFinite(numeric) ? numeric : 0,
      integer: /^\d+$/u.test(rawValue) && Number.isSafeInteger(numeric) && numeric <= 100000
    });
    if (numbers.length >= 4) break;
  }
  return numbers;
}

/** Перечисление по явным разделителям. Пусто — значит текст не список. */
function extractListItems(text) {
  const source = String(text ?? "");
  const splitters = [/\s*;\s*/u, /\s*[•·]\s*/u, /(?:^|\s)\d+[).]\s+/u];
  for (const splitter of splitters) {
    const parts = cleanList(source.split(splitter));
    if (parts.length >= 3) return parts;
  }
  for (const sentence of splitSentences(source)) {
    const parts = cleanList(sentence.replace(/[.!?…]+$/u, "").split(/\s*,\s*/u));
    if (parts.length >= 3 && parts.every(part => part.length <= 40)) return parts;
  }
  return [];
}

function extractQuote(text) {
  const source = String(text ?? "");
  const match = source.match(QUOTE_PATTERN);
  if (!match) return null;
  const quote = cleanItem(match[1], 220);
  if (!quote) return null;
  const tail = source.slice(match.index + match[0].length);
  const attribution = tail.match(ATTRIBUTION_PATTERN);
  return { text: quote, source: attribution ? cleanItem(attribution[1], 48) : "" };
}

function extractPair(text) {
  const source = String(text ?? "").trim();
  for (const rule of CONTRAST_RULES) {
    const match = source.match(rule.pattern);
    if (!match) continue;
    const first = cleanItem(match[1], 96);
    const second = cleanItem(match[2], 96);
    if (!first || !second) continue;
    const [leftText, rightText] = rule.swap ? [second, first] : [first, second];
    return {
      left: { label: rule.labels[0], text: leftText, items: [] },
      right: { label: rule.labels[1], text: rightText, items: [] }
    };
  }
  return null;
}

/**
 * Полное содержимое сцены для архетипов. `bullets` всегда непусто (там же
 * лежит откат на предложения), `items` — только настоящее перечисление.
 */
export function deriveSceneContent(scene) {
  if (!scene || typeof scene !== "object") throw new TypeError("Scene is required");
  const title = clampText(scene.title, 120);
  const narration = String(scene.narration ?? scene.text ?? "");
  const lead = clampText(pickLeadSentence(narration, scene.title), 180);
  const titleKey = sentenceKey(scene.title);
  const body = splitSentences(narration)
    .filter(sentence => sentenceKey(sentence) !== titleKey)
    .join(" ");
  const data = normalizeSceneData(scene.sceneData);
  const items = data.items ?? extractListItems(body);
  const sentences = splitSentences(body);
  const bullets = items.length
    ? items
    : sentences.length
      ? cleanList(sentences, { limit: 72, max: 4 })
      : [title].filter(Boolean);
  const hasStepMarkers = KEYWORDS.steps.test(body);
  const steps = data.steps ?? (hasStepMarkers ? (items.length ? items : cleanList(sentences, { limit: 48, max: 5 })) : []);
  return {
    title,
    lead,
    body,
    items,
    bullets,
    steps,
    hasStepMarkers,
    numbers: extractNumbers(body),
    pair: data.compare ?? extractPair(body),
    quote: data.quote ?? extractQuote(narration),
    data
  };
}

function rankArchetypes(content) {
  const { data, body } = content;
  const ranked = [];
  const push = archetype => {
    if (!ranked.includes(archetype)) ranked.push(archetype);
  };

  // Явные поля карточки — сильнейший сигнал: автор уже описал структуру кадра.
  if (data.columns) push("board-columns");
  if (data.formats) push("format-trio");
  if (data.device) push("device-mockup");
  if (data.stat) push("stat-highlight");
  if (data.compare) push("comparison");
  if (data.steps) push("flow-steps");
  if (data.quote) push("quote");
  if (data.items) push("checklist");

  if (KEYWORDS.board.test(body)) push("board-columns");
  if (KEYWORDS.formats.test(body)) push("format-trio");
  if (KEYWORDS.device.test(body)) push("device-mockup");
  if (content.quote) push("quote");
  if (content.pair) push("comparison");
  if (content.numbers.length >= 2) push("metric-grid");
  if (content.numbers.length === 1) push("stat-highlight");
  if (content.steps.length >= 3) push("flow-steps");
  if (KEYWORDS.checklist.test(body) && content.bullets.length >= 2) push("checklist");
  if (content.items.length >= 3) push("checklist");
  // Ни один сигнал не сработал — остаётся текущий макет, как и было до архетипов.
  push("classic");
  return ranked;
}

function roleForIndex(sceneIndex, sceneCount) {
  if (sceneIndex === 0) return "opening";
  if (sceneCount >= 3 && sceneIndex === sceneCount - 1) return "closing";
  return "body";
}

/**
 * Архетип одной сцены. `previous` разводит подряд идущие одинаковые композиции;
 * без него (одиночный вызов) выбор зависит только от самой карточки.
 */
export function pickSceneArchetype({ scene, sceneIndex = 0, sceneCount = 1, previous = "", content } = {}) {
  const index = Number.isSafeInteger(sceneIndex) && sceneIndex >= 0 ? sceneIndex : 0;
  const count = Number.isSafeInteger(sceneCount) && sceneCount > 0 ? sceneCount : 1;
  const role = roleForIndex(index, count);
  const explicit = normalizeArchetype(scene?.sceneType);
  if (explicit) return { archetype: explicit, role, source: "explicit" };
  if (role !== "body") return { archetype: "statement", role, source: "role" };

  const sceneContent = content ?? deriveSceneContent(scene);
  const ranked = rankArchetypes(sceneContent);
  const distinct = ranked.find(archetype => archetype !== previous);
  if (distinct) return { archetype: distinct, role, source: "heuristic" };
  const rotation = NEUTRAL_ROTATION.filter(archetype => archetype !== previous);
  return { archetype: rotation[index % rotation.length], role, source: "rotation" };
}

/** Выбор для всей раскадровки: гарантирует, что соседние сцены не совпадают. */
export function planSceneArchetypes(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  const plan = [];
  let previous = "";
  for (const [sceneIndex, scene] of list.entries()) {
    const picked = pickSceneArchetype({ scene, sceneIndex, sceneCount: list.length, previous });
    plan.push(picked);
    previous = picked.archetype;
  }
  return plan;
}
