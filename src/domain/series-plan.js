// Сериал: тема → библия (персонажи, тон, сквозные шутки) и сезон серий, каждая
// из которых знает, что уже произошло в предыдущих. Domain-слой: ни HTTP, ни
// рендера — только контракт с текст-моделью, строгая валидация и сборка брифа
// серии, который дальше уходит в AI Director как обычная тема ролика.
//
// Преемственность держится не на «памяти» модели, а на данных: серия объявляет
// в carriesForward факты, которые переносит дальше, и бриф серии N собирается
// ровно из carriesForward серий 1..N-1. Придумывать прошлое запрещено.

import { extractJsonPayload } from "./ai-director.js";
import { formatDurationLabel } from "./duration-plan.js";

export const SERIES_PLAN_LIMITS = Object.freeze({
  minEpisodes: 1,
  maxEpisodes: 12,
  minCharacters: 1,
  maxCharacters: 5,
  maxRunningGags: 5,
  maxTraits: 5,
  maxBeats: 6,
  maxCarriesForward: 4
});

// Порядок значим: позиция в арке выводится из него, когда модель промолчала.
export const ARC_POSITIONS = Object.freeze(["setup", "escalation", "turn", "payoff"]);

const MAX_TOPIC_CHARS = 300;
const MAX_SERIES_TITLE_CHARS = 120;
const MAX_PREMISE_CHARS = 400;
const MAX_TONE_CHARS = 120;
const MAX_VISUAL_STYLE_CHARS = 200;
const MAX_LANGUAGE_CHARS = 16;
const MAX_CHARACTER_NAME_CHARS = 80;
const MAX_CHARACTER_ROLE_CHARS = 120;
const MAX_TRAIT_CHARS = 60;
const MAX_APPEARANCE_CHARS = 200;
const MAX_GAG_CHARS = 120;
const MAX_EPISODE_TITLE_CHARS = 120;
const MAX_LOGLINE_CHARS = 240;
const MAX_BEAT_CHARS = 200;
const MAX_FACT_CHARS = 200;

export function buildSeriesPrompt({
  topic,
  language = "ru",
  episodeCount = 4,
  episodeDurationSeconds = null,
  audience,
  tone
}) {
  const episodes = clampEpisodeCount(episodeCount);
  const duration = Number(episodeDurationSeconds);
  const durationBlock = Number.isFinite(duration) && duration > 0
    ? [`Каждая серия звучит примерно ${formatDurationLabel(duration)} — держи ${episodes === 1 ? "серию" : "серии"} такого масштаба, без лишних линий.`]
    : [];
  const shape = [
    '{"series": {"title": "название сериала", "premise": "о чём он", "tone": "тон", "visualStyle": "визуальный стиль",',
    ' "characters": [{"name": "имя", "role": "роль в истории", "traits": ["черта"], "appearance": "как выглядит"}],',
    ' "runningGags": ["сквозная шутка"]},',
    ' "episodes": [{"title": "название серии", "logline": "суть серии одной фразой", "beats": ["ход сюжета"],',
    ` "arcPosition": "${ARC_POSITIONS.join('|')}", "carriesForward": ["факт, который знают следующие серии"]}]}`
  ].join("\n");
  return [
    `Ты — шоураннер короткого анимационного сериала. Тема: «${topic}».`,
    `Придумай библию сериала и ровно ${episodes} ${pluralizeEpisodes(episodes)} на языке "${language}".`,
    audience ? `Аудитория: ${audience}.` : "",
    tone ? `Тон: ${tone}.` : "",
    ...durationBlock,
    `Персонажей — от ${SERIES_PLAN_LIMITS.minCharacters} до ${SERIES_PLAN_LIMITS.maxCharacters}, они сквозные: одни и те же во всех сериях.`,
    "Серии идут по нарастающей: первая знакомит с миром, последняя закрывает арку.",
    "В carriesForward каждой серии перечисли факты, которые следующие серии обязаны знать (что случилось, что изменилось).",
    `arcPosition — одно из: ${ARC_POSITIONS.join(", ")}.`,
    "Ответь ТОЛЬКО валидным JSON без пояснений, строго такой формы:",
    shape
  ].filter(Boolean).join("\n");
}

/**
 * Граница доверия: rawText пришёл от модели, то есть это враждебный ввод.
 * Лишние поля отбрасываются, длины режутся, недостающая обязательная часть —
 * явная ошибка, а не тихо пустой план.
 */
export function parseSeriesPlan(rawText, { episodeCount, language } = {}) {
  const payload = extractJsonPayload(rawText);
  if (!payload) throw new RangeError("ответ не является JSON-объектом");

  const seriesInput = payload.series;
  if (!seriesInput || typeof seriesInput !== "object" || Array.isArray(seriesInput)) {
    throw new RangeError("в плане нет блока series");
  }
  const title = cleanLine(seriesInput.title, MAX_SERIES_TITLE_CHARS);
  if (!title) throw new RangeError("в плане нет названия сериала (series.title)");
  const premise = cleanLine(seriesInput.premise, MAX_PREMISE_CHARS);
  if (!premise) throw new RangeError("в плане нет завязки сериала (series.premise)");

  const characters = normalizeCharacters(seriesInput.characters);
  if (characters.length < SERIES_PLAN_LIMITS.minCharacters) {
    throw new RangeError("в плане нет ни одного пригодного персонажа (series.characters)");
  }

  const episodes = normalizeEpisodes(payload.episodes, episodeCount);

  return deepFreeze({
    series: {
      title,
      premise,
      tone: cleanLine(seriesInput.tone, MAX_TONE_CHARS),
      visualStyle: cleanLine(seriesInput.visualStyle, MAX_VISUAL_STYLE_CHARS),
      language: cleanLine(language, MAX_LANGUAGE_CHARS)
        || cleanLine(seriesInput.language, MAX_LANGUAGE_CHARS)
        || "ru",
      characters,
      runningGags: cleanList(seriesInput.runningGags, SERIES_PLAN_LIMITS.maxRunningGags, MAX_GAG_CHARS)
    },
    episodes
  });
}

/**
 * Бриф одной серии для AI Director: тема ролика, факты предыдущих серий и
 * сквозные персонажи. Для первой серии преемственность пуста — прошлого ещё
 * не было, и выдумывать его нельзя.
 */
export function buildEpisodeBrief({ plan, episodeNumber }) {
  const episodes = Array.isArray(plan?.episodes) ? plan.episodes : [];
  if (!plan?.series || episodes.length === 0) {
    throw new RangeError("buildEpisodeBrief requires a parsed series plan");
  }
  const number = Math.trunc(Number(episodeNumber));
  if (!Number.isFinite(number) || number < 1 || number > episodes.length) {
    throw new RangeError(`episodeNumber must be between 1 and ${episodes.length}`);
  }
  const episode = episodes[number - 1];
  const continuity = [];
  for (const previous of episodes.slice(0, number - 1)) {
    for (const fact of asArray(previous?.carriesForward)) {
      continuity.push(`Серия ${previous.number} «${previous.title}»: ${fact}`);
    }
  }
  return deepFreeze({
    topic: cleanLine(`${plan.series.title}. Серия ${number}: ${episode.title}. ${episode.logline}`, MAX_TOPIC_CHARS),
    continuity,
    characters: asArray(plan.series.characters)
      .map(character => ({ ...character, traits: asArray(character?.traits).slice() })),
    beats: asArray(episode.beats).slice()
  });
}

export async function planSeriesFromTopic({
  topic,
  language = "ru",
  episodeCount = 4,
  episodeDurationSeconds = null,
  audience,
  tone,
  textModel,
  maxAttempts = 2,
  signal
}) {
  const cleanTopic = cleanLine(topic, MAX_TOPIC_CHARS);
  if (!cleanTopic) throw new RangeError("Series topic is required");
  if (!textModel || typeof textModel.complete !== "function") {
    throw new TypeError("planSeriesFromTopic requires a text model with complete()");
  }
  const episodes = clampEpisodeCount(episodeCount);
  const basePrompt = buildSeriesPrompt({
    topic: cleanTopic,
    language,
    episodeCount: episodes,
    episodeDurationSeconds,
    audience,
    tone
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
    try {
      return parseSeriesPlan(reply, { episodeCount: episodes, language });
    } catch (error) {
      lastFailure = error.message;
    }
  }
  throw new RangeError(`Series plan failed after ${maxAttempts} attempts: ${lastFailure}`);
}

function normalizeCharacters(input) {
  const list = Array.isArray(input) ? input : [];
  const characters = [];
  for (const character of list) {
    if (characters.length >= SERIES_PLAN_LIMITS.maxCharacters) break;
    const name = cleanLine(character?.name, MAX_CHARACTER_NAME_CHARS);
    if (!name) continue;
    // id выдаём мы, а не модель: он должен быть стабильным между сериями и
    // безопасным для подстановки в промпты и файлы.
    characters.push({
      id: `char-${characters.length + 1}`,
      name,
      role: cleanLine(character?.role, MAX_CHARACTER_ROLE_CHARS),
      traits: cleanList(character?.traits, SERIES_PLAN_LIMITS.maxTraits, MAX_TRAIT_CHARS),
      appearance: cleanLine(character?.appearance, MAX_APPEARANCE_CHARS)
    });
  }
  return characters;
}

function normalizeEpisodes(input, requestedCount) {
  const list = Array.isArray(input) ? input : [];
  const usable = [];
  for (const episode of list) {
    if (usable.length >= SERIES_PLAN_LIMITS.maxEpisodes) break;
    const title = cleanLine(episode?.title, MAX_EPISODE_TITLE_CHARS);
    const logline = cleanLine(episode?.logline, MAX_LOGLINE_CHARS);
    if (!title || !logline) continue;
    usable.push({ title, logline, source: episode });
  }
  const expected = requestedCount === undefined || requestedCount === null
    ? clampEpisodeCount(usable.length)
    : clampEpisodeCount(requestedCount);
  if (usable.length < expected) {
    throw new RangeError(`модель вернула ${usable.length} пригодных серий вместо ${expected}`);
  }
  return usable.slice(0, expected).map((episode, index) => ({
    number: index + 1,
    title: episode.title,
    logline: episode.logline,
    beats: cleanList(episode.source?.beats, SERIES_PLAN_LIMITS.maxBeats, MAX_BEAT_CHARS),
    arcPosition: resolveArcPosition(episode.source?.arcPosition, index, expected),
    carriesForward: cleanList(episode.source?.carriesForward, SERIES_PLAN_LIMITS.maxCarriesForward, MAX_FACT_CHARS)
  }));
}

// Модельное значение уважаем, но только из словаря. Молчание модели — не повод
// оставлять поле пустым: положение в арке однозначно выводится из номера серии.
function resolveArcPosition(value, index, total) {
  const declared = cleanLine(value, 32).toLowerCase();
  if (ARC_POSITIONS.includes(declared)) return declared;
  if (index === 0) return "setup";
  if (index === total - 1) return "payoff";
  if (index === total - 2) return "turn";
  return "escalation";
}

function clampEpisodeCount(value) {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count)) return SERIES_PLAN_LIMITS.minEpisodes;
  return Math.min(Math.max(count, SERIES_PLAN_LIMITS.minEpisodes), SERIES_PLAN_LIMITS.maxEpisodes);
}

function pluralizeEpisodes(count) {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "серий";
  const last = count % 10;
  if (last === 1) return "серию";
  if (last >= 2 && last <= 4) return "серии";
  return "серий";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanList(value, maxItems, maxChars) {
  const list = asArray(value);
  const cleaned = [];
  for (const item of list) {
    if (cleaned.length >= maxItems) break;
    const line = cleanLine(item, maxChars);
    if (line) cleaned.push(line);
  }
  return cleaned;
}

function cleanLine(value, maxChars) {
  if (value === null || value === undefined || typeof value === "object") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return Object.freeze(value);
  }
  return value;
}
