// Multilingual editions: from a completed project produce the SAME video in a
// target language B. Pure/injected core — no fs, no network. Translation and
// voice are resolved here; the translated board is fed back through the EXISTING
// render path (render-project.js is not modified). See
// docs/plans/2026-07-24-multilingual-editions.md.

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
  return Object.freeze({
    id: typeof id === "string" && id ? id : deriveEditionId(projectId, target),
    projectId,
    sourceLanguage,
    targetLanguage: target,
    status,
    voiceProvider: voice.provider,
    voiceId: voice.voiceId,
    message: voice.message,
    segments: Object.freeze(segments.map(Object.freeze))
  });
}

function assertProject(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("Edition project must be an object");
  }
  return project;
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
