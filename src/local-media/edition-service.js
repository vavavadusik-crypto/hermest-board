// Server side of "create a multilingual edition": resolve the target voice,
// translate the narration through the EXISTING text model, and rebuild a
// renderable board in the target language. The client renders that board via
// the existing POST /api/local-media/render — no new render surface.
// Fail-closed on the text-model bridge (mirrors draft-service): without it there
// is no translation. Voice resolution failure is a normal voice_missing result,
// not an error.

import { createOpenAiTextModel } from "../media/openai-text-model.js";
import { createEditionTranslator } from "../media/edition-translator.js";
import { createBridgeTextModel, describeBridgeAvailability } from "../media/text-model.js";
import {
  EDITION_STATUSES,
  buildEditionManifest,
  buildTranslatedProject,
  createEdition,
  translateEdition
} from "../media/edition.js";

export async function editionService({
  project,
  targetLanguage,
  endpoint,
  model,
  signal,
  env = process.env,
  textModel = null,
  availabilityCheck = null
} = {}) {
  // createEdition validates the project + language and resolves the voice.
  const edition = createEdition({ project, targetLanguage, env });
  if (edition.status === EDITION_STATUSES.VOICE_MISSING) {
    return { edition, project: null, manifest: null };
  }

  // A direct OpenAI-compatible endpoint does not depend on the browser bridge.
  if (!isOpenAiEndpoint(endpoint)) {
    const availability = await (availabilityCheck || describeBridgeAvailability)();
    if (availability?.status !== "executable") {
      const reason = availability?.reason || "text model bridge is not available";
      throw Object.assign(new Error(reason), { statusCode: 503 });
    }
  }

  const translator = createEditionTranslator({
    textModel: textModel || createEditionTextModel({ endpoint, model })
  });
  const translated = await translateEdition(edition, {
    translate: params => translator.translate(params),
    modelId: translator.modelId,
    signal
  });

  if (translated.status !== EDITION_STATUSES.READY) {
    return { edition: translated, project: null, manifest: null };
  }
  return {
    edition: translated,
    project: buildTranslatedProject(project, translated),
    manifest: buildEditionManifest(translated)
  };
}

// Trimmed edition for the HTTP boundary: status + provenance the UI needs, no
// raw per-segment text (the translated board already carries the content).
export function toPublicEdition(edition) {
  if (!edition || typeof edition !== "object") return null;
  return {
    id: edition.id,
    projectId: edition.projectId,
    sourceLanguage: edition.sourceLanguage,
    targetLanguage: edition.targetLanguage,
    status: edition.status,
    voiceProvider: edition.voiceProvider,
    voiceId: edition.voiceId,
    translationModelId: edition.translationModelId || null,
    message: edition.message || null,
    sceneCount: Array.isArray(edition.segments) ? edition.segments.length : 0
  };
}

function isOpenAiEndpoint(endpoint) {
  return endpoint?.kind === "openai";
}

function createEditionTextModel({ endpoint, model }) {
  if (isOpenAiEndpoint(endpoint)) {
    return createOpenAiTextModel({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model || model
    });
  }
  return createBridgeTextModel({ model });
}
