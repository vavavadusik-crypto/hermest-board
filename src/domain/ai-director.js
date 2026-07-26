// AI Director: превращает тему в рендерящийся board через провайдер-нейтральную
// text-модель (браузерный GPT через мост, BYOK-модель — любую, у кого есть
// complete()). Domain-слой: никакого HTTP здесь, только контракт и валидация.

import { buildStoryboard } from "./content-pipeline.js";
import {
  describeDurationBudget,
  formatDurationLabel,
  normalizeTargetDurationSeconds
} from "./duration-plan.js";

const MAX_TOPIC_CHARS = 300;
const MAX_TITLE_CHARS = 160;
const MAX_CARD_TITLE_CHARS = 120;
const MAX_CARD_TEXT_CHARS = 600;
const MIN_SCENES = 2;
const MAX_SCENES = 12;
const GRID_ORIGIN = 80;
const GRID_STEP_X = 420;
const GRID_STEP_Y = 260;
const GRID_COLUMNS = 3;
const MAX_CAST = 3;
const MAX_LINE_CHARS = 180;
const MAX_CAPTION_CHARS = 28;
const CARTOON_POSE_HINTS = "idle, talk, point, type, shrug, facepalm, cheer, think, walk";
const CARTOON_SETTING_HINTS = "desk, room, street, void";

export function buildDirectorPrompt({
  topic,
  language = "ru",
  sceneCount = 5,
  audience,
  tone,
  sources = [],
  targetDurationSeconds = null,
  cartoon = false
}) {
  const sourceLines = sources.map(source => {
    const year = source.year ? `, ${source.year}` : "";
    const snippet = source.snippet ? ` — ${source.snippet}` : "";
    return `- ${source.id}: ${source.title} (${source.source}${year}) ${source.url}${snippet}`;
  });
  const researchBlock = sourceLines.length
    ? [
      "Проверенные источники (опирайся ТОЛЬКО на них; фантазировать факты запрещено):",
      ...sourceLines,
      "Каждой карточке проставь sourceRefs — массив id источников, подтверждающих её текст (пустой массив, если утверждение общеизвестно)."
    ]
    : [];
  const cardShape = sourceLines.length
    ? `{"title": "название видео", "cards": [{"title": "заголовок сцены", "text": "закадровый текст", "sourceRefs": ["src-..."]}]}`
    : `{"title": "название видео", "cards": [{"title": "заголовок сцены", "text": "закадровый текст"}]}`;
  // Длительность ролика предсказуема по непробельным символам, поэтому бюджет
  // текста уходит модели явной цифрой — иначе она пишет «сколько напишется».
  const budget = targetDurationSeconds
    ? describeDurationBudget({ targetDurationSeconds, sceneCount })
    : null;
  const durationBlock = budget
    ? [
      `Ролик должен звучать ${formatDurationLabel(targetDurationSeconds)}.`,
      `На это нужно примерно ${budget.recommendedCharacters} непробельных символов закадрового текста суммарно, то есть около ${Math.round(budget.recommendedCharacters / sceneCount)} символов на сцену. Держись этого объёма.`
    ]
    : [];
  if (cartoon) {
    return buildCartoonPrompt({ topic, language, sceneCount, audience, tone, durationBlock, researchBlock });
  }
  return [
    `Ты — режиссёр коротких обучающих видео. Тема: «${topic}».`,
    `Составь план видео из ровно ${sceneCount} сцен на языке "${language}".`,
    audience ? `Аудитория: ${audience}.` : "",
    tone ? `Тон: ${tone}.` : "",
    ...durationBlock,
    "Каждая сцена — карточка с коротким заголовком и 1–2 предложениями закадрового текста.",
    "Первая карточка — цепляющий вход в тему, последняя — вывод или призыв.",
    ...researchBlock,
    "Ответь ТОЛЬКО валидным JSON без пояснений, строго такой формы:",
    cardShape
  ].filter(Boolean).join("\n");
}

// Мультрежим — это сценарий, а не пересказ: сцена держится на реплике, а не на
// абзаце закадрового текста. Труппа объявляется ОДИН раз на весь ролик и дальше
// сцены ссылаются на id: внешность персонажа выводится из id детерминированно,
// поэтому «новый» персонаж в третьей сцене — это другое лицо, даже с тем же именем.
function buildCartoonPrompt({ topic, language, sceneCount, audience, tone, durationBlock, researchBlock }) {
  const shape = '{"title": "название ролика", "cast": [{"id": "char-1", "name": "имя", "role": "кто это"}],'
    + ' "cards": [{"title": "заголовок сцены", "cartoon": {"setting": "desk", "speaker": "char-1",'
    + ' "line": "реплика персонажа", "pose": "talk", "with": ["char-2"], "withPose": "shrug", "caption": "Понедельник. Офис."}}]}';
  return [
    `Ты — сценарист короткого мультфильма. Тема: «${topic}».`,
    `Напиши ровно ${sceneCount} сцен на языке "${language}".`,
    audience ? `Аудитория: ${audience}.` : "",
    tone ? `Тон: ${tone}.` : "",
    ...durationBlock,
    `Сначала объяви труппу: от 1 до ${MAX_CAST} персонажей с постоянными id вида "char-1". Дальше ссылайся ТОЛЬКО на эти id — новых персонажей по ходу не вводи.`,
    "Каждая сцена — одна реплика одного персонажа. Реплика — живая прямая речь, а не пересказ темы: так, как человек сказал бы это вслух.",
    `Длина реплики — до ${MAX_LINE_CHARS} символов.`,
    `Поле setting — одно из: ${CARTOON_SETTING_HINTS}.`,
    `Поле pose (поза говорящего) и withPose (поза второго персонажа) — одно из: ${CARTOON_POSE_HINTS}.`,
    `caption — короткая подпись места и времени, до ${MAX_CAPTION_CHARS} символов, или пустая строка.`,
    "with — id остальных персонажей в кадре (0 или 1 персонаж), они молчат.",
    "Сцены должны складываться в историю: у неё есть завязка и развязка, а не список тезисов.",
    ...researchBlock,
    "Ответь ТОЛЬКО валидным JSON без пояснений, строго такой формы:",
    shape
  ].filter(Boolean).join("\n");
}

export function extractJsonPayload(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function draftBoardFromTopic({
  topic,
  language = "ru",
  audience,
  tone,
  sceneCount = 5,
  targetDurationSeconds = null,
  voice = "",
  narrationProvider = "",
  textModel,
  sources = [],
  cartoon = false,
  maxAttempts = 2,
  signal
}) {
  const cleanTopic = String(topic ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_CHARS);
  if (!cleanTopic) throw new RangeError("Draft topic is required");
  if (!textModel || typeof textModel.complete !== "function") {
    throw new TypeError("draftBoardFromTopic requires a text model with complete()");
  }
  const scenes = Math.min(Math.max(Number(sceneCount) || 5, MIN_SCENES), MAX_SCENES);
  const targetDuration = normalizeTargetDurationSeconds(targetDurationSeconds);
  const researchSources = normalizeResearchSources(sources);
  const basePrompt = buildDirectorPrompt({
    topic: cleanTopic,
    language,
    sceneCount: scenes,
    audience,
    tone,
    sources: researchSources,
    targetDurationSeconds: targetDuration,
    cartoon
  });

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
      return assembleBoard(payload, {
        topic: cleanTopic,
        language,
        audience,
        tone,
        voice,
        narrationProvider,
        sceneCount: scenes,
        targetDurationSeconds: targetDuration,
        sources: researchSources,
        cartoon
      });
    } catch (error) {
      lastFailure = error.message;
    }
  }
  throw new RangeError(`AI Director draft failed after ${maxAttempts} attempts: ${lastFailure}`);
}

function assembleBoard(payload, {
  topic,
  language,
  audience,
  tone,
  voice,
  narrationProvider,
  sceneCount,
  targetDurationSeconds = null,
  sources = [],
  cartoon = false
}) {
  const troupe = cartoon ? normalizeTroupe(payload.cast) : [];
  if (cartoon && !troupe.length) throw new RangeError("модель не объявила труппу");
  const allowedSourceIds = new Set(sources.map(source => source.id));
  const cardsInput = Array.isArray(payload.cards) ? payload.cards : [];
  const cards = [];
  for (const [index, card] of cardsInput.entries()) {
    if (cards.length >= sceneCount) break;
    const title = cleanLine(card?.title, MAX_CARD_TITLE_CHARS);
    // В мультрежиме закадровый текст — это и есть реплика: диктор произносит
    // то, что персонаж говорит в кадре, иначе звук расходится с картинкой.
    const scene = cartoon ? buildCartoonScene(card?.cartoon, troupe) : null;
    const text = cartoon
      ? cleanLine(scene?.line, MAX_CARD_TEXT_CHARS)
      : cleanLine(card?.text, MAX_CARD_TEXT_CHARS);
    if (!title || !text) continue;
    // Ссылки на источники проходят только из канонического списка — модель не
    // может «сослаться» на несуществующий источник.
    const sourceRefs = allowedSourceIds.size
      ? [...new Set((Array.isArray(card?.sourceRefs) ? card.sourceRefs : [])
        .map(ref => String(ref ?? "").trim())
        .filter(ref => allowedSourceIds.has(ref)))]
      : [];
    cards.push({
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      x: GRID_ORIGIN + (cards.length % GRID_COLUMNS) * GRID_STEP_X,
      y: GRID_ORIGIN + Math.floor(cards.length / GRID_COLUMNS) * GRID_STEP_Y,
      title,
      text,
      ...(scene ? { sceneType: "cartoon", sceneData: { cartoon: scene } } : {}),
      ...(allowedSourceIds.size ? { sourceRefs } : {})
    });
  }
  if (cards.length === 0) throw new RangeError("модель не вернула пригодных карточек");
  const board = {
    schemaVersion: 1,
    title: cleanLine(payload.title, MAX_TITLE_CHARS) || topic,
    brief: {
      topic,
      language,
      ...(audience ? { audience } : {}),
      ...(tone ? { tone } : {}),
      ...(targetDurationSeconds ? { targetDurationSeconds } : {}),
      voice,
      narrationProvider
    },
    cards,
    ...(sources.length ? { sources } : {})
  };
  // Единственный критерий годности драфта — он рендерится нашим же конвейером.
  buildStoryboard(board);
  return board;
}

// Труппа — источник постоянства: id живёт весь ролик, внешность выводится из него.
function normalizeTroupe(raw) {
  if (!Array.isArray(raw)) return [];
  const troupe = [];
  const seen = new Set();
  for (const [index, member] of raw.slice(0, MAX_CAST).entries()) {
    const name = cleanLine(member?.name, 28);
    const id = cleanLine(member?.id, 40) || `char-${index + 1}`;
    if (!name || seen.has(id)) continue;
    seen.add(id);
    troupe.push({ id, name });
  }
  return troupe;
}

function buildCartoonScene(raw, troupe) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !troupe.length) return null;
  const line = cleanLine(raw.line, MAX_LINE_CHARS);
  if (!line) return null;
  const byId = new Map(troupe.map(member => [member.id, member]));
  // Неизвестный говорящий — не повод изобретать персонажа: реплику произносит
  // первый из объявленной труппы, состав кадра остаётся честным.
  const speaker = byId.get(cleanLine(raw.speaker, 40)) ?? troupe[0];
  const companionId = (Array.isArray(raw.with) ? raw.with : [])
    .map(value => cleanLine(value, 40))
    .find(value => byId.has(value) && value !== speaker.id);
  const companion = companionId ? byId.get(companionId) : null;
  const cast = [{ id: speaker.id, name: speaker.name, pose: cleanLine(raw.pose, 24) || "talk", side: "left", speaking: true }];
  if (companion) {
    cast.push({ id: companion.id, name: companion.name, pose: cleanLine(raw.withPose, 24) || "idle", side: "right", speaking: false });
  }
  return {
    setting: cleanLine(raw.setting, 24) || "void",
    cast,
    line,
    caption: cleanLine(raw.caption, MAX_CAPTION_CHARS)
  };
}

function normalizeResearchSources(sources) {
  if (!Array.isArray(sources)) return [];
  const normalized = [];
  for (const source of sources.slice(0, 16)) {
    const id = cleanLine(source?.id, 64);
    const title = cleanLine(source?.title, 200);
    const url = String(source?.url ?? "").trim();
    if (!id || !title || !/^https:\/\//.test(url)) continue;
    normalized.push({
      id,
      source: cleanLine(source?.source, 40) || "web",
      title,
      url,
      ...(source?.snippet ? { snippet: cleanLine(source.snippet, 240) } : {}),
      ...(Number.isSafeInteger(source?.year) ? { year: source.year } : {})
    });
  }
  return normalized;
}

function cleanLine(value, maxChars) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}
