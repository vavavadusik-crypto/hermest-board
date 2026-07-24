// Multilingual editions: from a completed project produce the SAME video in a
// target language B. Pure/injected core — no fs, no network. Translation and
// voice are resolved here; the translated board is fed back through the EXISTING
// render path (render-project.js is not modified). See
// docs/plans/2026-07-24-multilingual-editions.md.

import { createHash } from "node:crypto";

import { buildStoryboard } from "../domain/content-pipeline.js";
import { describeElevenLabsAvailability } from "./elevenlabs-tts.js";
import { hashJson } from "./manifest.js";
import { resolvePiperVoice } from "./piper-tts.js";

export const EDITION_STATUSES = Object.freeze({
  DRAFT: "draft",
  TRANSLATING: "translating",
  READY: "ready",
  VOICE_MISSING: "voice_missing",
  ERROR: "error"
});

const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
// ElevenLabs multilingual covers languages Piper does not; a stable marker keeps
// the edition record honest without leaking the internal default voice id.
const ELEVENLABS_VOICE_MARKER = "elevenlabs:eleven_multilingual_v2";
const PIPER_LANGUAGES = Object.freeze(["ru", "en", "es", "de", "fr"]);

export function normalizeLanguageCode(value) {
  const language = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!language || !LANGUAGE_PATTERN.test(language)) {
    throw new RangeError("Edition target language must be a language code (e.g. en, de, pt-br)");
  }
  return language;
}

// One segment per storyboard scene, keyed to the scene id so translation and
// re-render stay aligned with what the render path actually speaks.
export function deriveEditionSegments(project) {
  const storyboard = buildStoryboard(assertProject(project));
  return storyboard.scenes.map(scene => ({
    sceneId: String(scene.id),
    cardId: String(scene.cardId),
    sourceText: String(scene.narration)
  }));
}

export function resolveEditionVoice({ language, env = process.env } = {}) {
  const normalized = normalizeLanguageCode(language);
  const piperVoice = resolvePiperVoice({ language: normalized });
  if (piperVoice) {
    return { status: "ok", provider: "piper", voiceId: piperVoice, message: null };
  }
  if (describeElevenLabsAvailability({ env }).status === "executable") {
    return { status: "ok", provider: "elevenlabs", voiceId: ELEVENLABS_VOICE_MARKER, message: null };
  }
  return {
    status: EDITION_STATUSES.VOICE_MISSING,
    provider: null,
    voiceId: null,
    message:
      `Для языка «${normalized}» нет голоса. Установите ключ ElevenLabs ` +
      `или выберите язык с офлайн-голосом: ${PIPER_LANGUAGES.join(", ")}.`
  };
}

export function createEdition({ project, targetLanguage, id, env = process.env } = {}) {
  const board = assertProject(project);
  const target = normalizeLanguageCode(targetLanguage);
  const sourceLanguage = normalizeSourceLanguage(board?.brief?.language);
  const projectId = resolveProjectId(board);
  const voice = resolveEditionVoice({ language: target, env });
  const segments = deriveEditionSegments(board).map(segment => ({
    sceneId: segment.sceneId,
    cardId: segment.cardId,
    sourceText: segment.sourceText,
    translatedText: null,
    voiceId: voice.voiceId
  }));
  const status = voice.status === "ok" ? EDITION_STATUSES.DRAFT : EDITION_STATUSES.VOICE_MISSING;
  return freezeEdition({
    id: typeof id === "string" && id ? id : deriveEditionId(projectId, target),
    projectId,
    sourceLanguage,
    targetLanguage: target,
    status,
    voiceProvider: voice.provider,
    voiceId: voice.voiceId,
    translationModelId: null,
    message: voice.message,
    segments: Object.freeze(segments.map(Object.freeze))
  });
}

// Translate every segment through the injected translator, preserving scene
// mapping and order. draft -> translating -> ready; any failure or empty
// translation -> error with a user-safe message. voice_missing/ready/error
// editions pass through unchanged (nothing to translate).
export async function translateEdition(edition, { translate, modelId = null, signal } = {}) {
  assertEdition(edition);
  if (typeof translate !== "function") {
    throw new TypeError("translateEdition requires a translate() dependency");
  }
  if (edition.status !== EDITION_STATUSES.DRAFT) return edition;
  try {
    const translatedSegments = [];
    for (const segment of edition.segments) {
      signal?.throwIfAborted?.();
      const raw = await translate({ text: segment.sourceText, targetLanguage: edition.targetLanguage, signal });
      const translatedText = String(raw ?? "").trim();
      if (!translatedText) throw new RangeError("translator returned an empty translation");
      translatedSegments.push(Object.freeze({ ...segment, translatedText }));
    }
    return freezeEdition({
      ...edition,
      status: EDITION_STATUSES.READY,
      translationModelId: modelId,
      message: null,
      segments: Object.freeze(translatedSegments)
    });
  } catch (error) {
    return freezeEdition({
      ...edition,
      status: EDITION_STATUSES.ERROR,
      translationModelId: modelId,
      message: sanitizeEditionMessage(error)
    });
  }
}

// Rebuild a renderable board in the target language from a READY edition. The
// translated narration becomes each card's spoken text; original visuals
// (assetRef/image) and scene order are reused so only audio/subtitles change.
// Fed back through the EXISTING render path — render-project.js is not modified.
export function buildTranslatedProject(project, edition) {
  const board = assertProject(project);
  assertEdition(edition);
  if (edition.status !== EDITION_STATUSES.READY) {
    throw new RangeError("Edition must be translated (status=ready) before rebuilding the project");
  }
  const storyboard = buildStoryboard(board);
  if (storyboard.scenes.length !== edition.segments.length) {
    throw new RangeError("Edition segments no longer match the project scenes");
  }
  const cards = storyboard.scenes.map((scene, index) => {
    const segment = edition.segments[index];
    if (segment.sceneId !== String(scene.id)) {
      throw new RangeError("Edition segment/scene mapping drifted from the project");
    }
    const { title, text } = splitTranslatedNarration(segment.translatedText);
    const card = { id: String(scene.cardId), title, text, x: 0, y: index };
    if (scene.visual?.assetRef) card.assetRef = scene.visual.assetRef;
    if (scene.visual?.image) card.image = scene.visual.image;
    if (Array.isArray(scene.sourceRefs) && scene.sourceRefs.length > 0) {
      card.sourceRefs = [...scene.sourceRefs];
    }
    return card;
  });
  const sourceBrief = board.brief && typeof board.brief === "object" && !Array.isArray(board.brief)
    ? board.brief
    : {};
  const brief = {
    ...sourceBrief,
    language: edition.targetLanguage,
    voice: edition.voiceProvider === "piper" ? edition.voiceId : "",
    narrationProvider: edition.voiceProvider === "elevenlabs" ? "elevenlabs" : ""
  };
  return {
    ...board,
    projectId: `${edition.projectId}#${edition.targetLanguage}`,
    brief,
    cards
  };
}

// Provenance record for a translated edition: what language, which translation
// model and voice produced it, content hashes per segment, and (once rendered)
// the render manifest + video hashes. Additive to the render manifest, which
// already carries `language`.
export function buildEditionManifest(edition, { render = null, translationModelId } = {}) {
  assertEdition(edition);
  if (edition.status !== EDITION_STATUSES.READY) {
    throw new RangeError("Edition must be translated (status=ready) before building its manifest");
  }
  const manifest = {
    schemaVersion: 1,
    kind: "multilingual-edition",
    editionId: edition.id,
    projectId: edition.projectId,
    sourceLanguage: edition.sourceLanguage,
    targetLanguage: edition.targetLanguage,
    voiceProvider: edition.voiceProvider,
    voiceId: edition.voiceId,
    translationModelId: translationModelId ?? edition.translationModelId ?? null,
    segments: edition.segments.map(segment => ({
      sceneId: segment.sceneId,
      sourceSha256: sha256(segment.sourceText),
      translatedSha256: sha256(String(segment.translatedText ?? ""))
    })),
    render: normalizeRenderProvenance(render)
  };
  return manifest;
}

function normalizeRenderProvenance(render) {
  if (!render || typeof render !== "object") return null;
  const summary = {};
  if (SHA256_HEX.test(String(render.manifestSha256 || ""))) summary.manifestSha256 = render.manifestSha256;
  if (SHA256_HEX.test(String(render.videoSha256 || ""))) summary.videoSha256 = render.videoSha256;
  if (typeof render.recipeId === "string" && render.recipeId) summary.recipeId = render.recipeId.slice(0, 64);
  if (typeof render.platform === "string" && render.platform) summary.platform = render.platform.slice(0, 64);
  return Object.keys(summary).length > 0 ? summary : null;
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function assertProject(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("Edition project must be an object");
  }
  return project;
}

function assertEdition(edition) {
  if (!edition || typeof edition !== "object" || !Array.isArray(edition.segments)) {
    throw new TypeError("A valid edition object is required");
  }
  return edition;
}

function freezeEdition(edition) {
  return Object.freeze(edition);
}

// Split translated narration into a short heading (first sentence) + body so the
// on-screen h1 stays short while the spoken narration remains the full text.
function splitTranslatedNarration(value) {
  const clean = String(value ?? "").trim().replace(/\s+/gu, " ");
  const match = clean.match(/^(.+?[.!?…])\s+(.+)$/u);
  if (match && match[2]) return { title: match[1], text: match[2] };
  return { title: clean, text: "" };
}

// Never leak provider stacks, paths or JSON into a user-visible edition message.
function sanitizeEditionMessage(error) {
  const raw = String(error?.message || "translation failed")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/gu, "<path>")
    .replace(/\/[^\s"'<>]+/gu, "<path>")
    .replace(/[{}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
  return `Не удалось перевести издание: ${raw || "неизвестная ошибка"}.`;
}

function normalizeSourceLanguage(value) {
  const language = typeof value === "string" ? value.trim().toLowerCase() : "";
  return language && LANGUAGE_PATTERN.test(language) ? language : "en";
}

function resolveProjectId(project) {
  const explicit = typeof project.projectId === "string" ? project.projectId.trim() : "";
  if (explicit) return explicit.slice(0, 120);
  return `project:${hashJson(project).slice(0, 12)}`;
}

function deriveEditionId(projectId, targetLanguage) {
  return `edition_${hashJson({ projectId, targetLanguage }).slice(0, 16)}`;
}
