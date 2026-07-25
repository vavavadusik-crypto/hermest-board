// Серверная часть wizard'а «тема → board»: собирает research + AI Director в
// один вызов для локального HTTP-роута. Fail-closed по мосту (без него драфта
// не будет), fail-open по research (источники — усиление, а не условие).

import { draftBoardFromTopic } from "../domain/ai-director.js";
import { deriveSceneCountFromDuration, normalizeTargetDurationSeconds } from "../domain/duration-plan.js";
import { createOpenAiTextModel } from "../media/openai-text-model.js";
import { searchResearchSources } from "../media/research-sources.js";
import { createBridgeTextModel, describeBridgeAvailability } from "../media/text-model.js";

const MAX_TOPIC_CHARS = 300;
const MIN_SCENES = 2;
const MAX_SCENES = 12;
const DEFAULT_SCENES = 6;

export async function draftBoardService({
  topic,
  language = "ru",
  sceneCount,
  targetDurationSeconds,
  voice = "",
  narrationProvider = "",
  research = true,
  model,
  endpoint,
  signal,
  textModel,
  researchSearch = null,
  availabilityCheck = null
} = {}) {
  const cleanTopic = String(topic ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_CHARS);
  if (!cleanTopic) throw new TypeError("draft topic is required");
  const targetDuration = normalizeTargetDurationSeconds(targetDurationSeconds);
  // Число сцен считает система из выбранной длительности; явное значение —
  // ручное переопределение из «тонких настроек», оно всегда сильнее.
  const derivedScenes = targetDuration === null
    ? DEFAULT_SCENES
    : deriveSceneCountFromDuration(targetDuration, { minScenes: MIN_SCENES, maxScenes: MAX_SCENES }).sceneCount;
  const scenes = clampSceneCount(sceneCount ?? derivedScenes);

  // Прямой OpenAI-совместимый провайдер не зависит от браузерного моста:
  // проверять мост в этом режиме значит блокировать драфт без причины.
  if (!isOpenAiEndpoint(endpoint)) {
    const availability = await (availabilityCheck || describeBridgeAvailability)();
    if (availability?.status !== "executable") {
      const reason = availability?.reason || "text model bridge is not available";
      throw Object.assign(new Error(reason), { statusCode: 503 });
    }
  }

  const warnings = [];
  let sources = [];
  if (research !== false) {
    try {
      const found = await (researchSearch || searchResearchSources)(cleanTopic);
      sources = Array.isArray(found?.sources) ? found.sources : [];
      if (Array.isArray(found?.warnings)) warnings.push(...found.warnings.map(sanitizeWarning));
    } catch (error) {
      // Research — усиление драфта, а не его условие: падение источников
      // остаётся честным warning'ом, борд всё равно собирается.
      sources = [];
      warnings.push(sanitizeWarning(`research failed: ${String(error?.message || error)}`));
    }
  }

  const board = await draftBoardFromTopic({
    topic: cleanTopic,
    language,
    sceneCount: scenes,
    targetDurationSeconds: targetDuration,
    voice,
    narrationProvider,
    textModel: textModel || createDraftTextModel({ endpoint, model }),
    sources,
    signal
  });

  return { board, sources, warnings };
}

function isOpenAiEndpoint(endpoint) {
  return endpoint?.kind === "openai";
}

function createDraftTextModel({ endpoint, model }) {
  if (isOpenAiEndpoint(endpoint)) {
    return createOpenAiTextModel({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model || model
    });
  }
  return createBridgeTextModel({ model });
}

// Warnings уходят клиенту как есть, поэтому чистятся здесь: сообщения
// провайдеров research недоверенные — пути, стеки и длина режутся.
function sanitizeWarning(value) {
  return String(value)
    .replace(/[A-Za-z]:\\[^\s"'<>]+/gu, "<path>")
    .replace(/\/[^\s"'<>]+/gu, "<path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function clampSceneCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCENES;
  const rounded = Math.trunc(parsed);
  if (rounded < MIN_SCENES) return MIN_SCENES;
  if (rounded > MAX_SCENES) return MAX_SCENES;
  return rounded;
}
