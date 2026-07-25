import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeLengthScale } from "../domain/duration-plan.js";
import { assertSafeGeneratedPath } from "./ffmpeg-args.js";
import { probeMediaFile, resolvePiperBinaryPath, runMediaTool } from "./process-runner.js";
import { normalizeNarrationLanguage, normalizeNarrationScript } from "./tts.js";

const PIPER_PROVIDER = "piper";
const PIPER_SENTENCE_SILENCE = "0.35";
// Zero generator noise keeps VITS synthesis byte-deterministic, preserving the
// repeated-render manifest/hash reproducibility invariant of the media gate.
const PIPER_NOISE_SCALE = "0";
const PIPER_NOISE_WIDTH = "0";
const SAFE_ABSOLUTE_PATH = /^\/[A-Za-z0-9_./-]+$/;
const VOICE_NAME_PATTERN = /^[a-z]{2}_[A-Z]{2}-[a-z0-9]+-(?:x_low|low|medium|high)$/;

const PIPER_VOICE_CATALOG = Object.freeze({
  ru: Object.freeze(["ru_RU-dmitri-medium", "ru_RU-irina-medium"]),
  en: Object.freeze(["en_US-lessac-medium"]),
  es: Object.freeze(["es_ES-davefx-medium"]),
  de: Object.freeze(["de_DE-thorsten-medium"]),
  fr: Object.freeze(["fr_FR-siwis-medium"])
});

export function getPiperVoiceCatalog() {
  return PIPER_VOICE_CATALOG;
}

export function resolvePiperVoicesDirectory({ env = process.env, homeDirectory = os.userInfo().homedir } = {}) {
  const configured = typeof env.HERMEST_PIPER_VOICES_DIR === "string" ? env.HERMEST_PIPER_VOICES_DIR.trim() : "";
  if (configured) {
    if (!SAFE_ABSOLUTE_PATH.test(configured)) {
      throw new RangeError("HERMEST_PIPER_VOICES_DIR must be a safe absolute path");
    }
    return configured;
  }
  return path.join(homeDirectory, ".local", "share", "piper", "voices");
}

export function resolvePiperVoice({ language, voice } = {}) {
  const normalizedLanguage = normalizeNarrationLanguage(language).slice(0, 2);
  if (voice !== undefined && voice !== null && voice !== "") {
    if (typeof voice !== "string" || !VOICE_NAME_PATTERN.test(voice)) {
      throw new TypeError("Unknown narration voice");
    }
    const knownVoices = Object.values(PIPER_VOICE_CATALOG).flat();
    if (!knownVoices.includes(voice)) throw new TypeError("Unknown narration voice");
    return voice;
  }
  const languageVoices = PIPER_VOICE_CATALOG[normalizedLanguage];
  if (!languageVoices || languageVoices.length === 0) return null;
  return languageVoices[0];
}

export async function describePiperAvailability({
  language,
  voice,
  env = process.env,
  homeDirectory = os.userInfo().homedir,
  fileExists = defaultFileExists
} = {}) {
  let binaryPath = null;
  let voicesDirectory = null;
  try {
    binaryPath = resolvePiperBinaryPath({ env, homeDirectory });
    voicesDirectory = resolvePiperVoicesDirectory({ env, homeDirectory });
  } catch {
    return { provider: PIPER_PROVIDER, status: "invalid_configuration", binaryPath, voicesDirectory, voice: null, modelPath: null };
  }
  const resolvedVoice = resolvePiperVoice({ language, voice });
  if (!resolvedVoice) {
    return { provider: PIPER_PROVIDER, status: "no_voice_for_language", binaryPath, voicesDirectory, voice: null, modelPath: null };
  }
  if (!(await fileExists(binaryPath))) {
    return { provider: PIPER_PROVIDER, status: "missing_binary", binaryPath, voicesDirectory, voice: resolvedVoice, modelPath: null };
  }
  const modelPath = path.join(voicesDirectory, `${resolvedVoice}.onnx`);
  if (!(await fileExists(modelPath))) {
    return { provider: PIPER_PROVIDER, status: "missing_voice_model", binaryPath, voicesDirectory, voice: resolvedVoice, modelPath };
  }
  return { provider: PIPER_PROVIDER, status: "executable", binaryPath, voicesDirectory, voice: resolvedVoice, modelPath };
}

export function createPiperNarrationAdapter(dependencies = {}) {
  const runTool = dependencies.runTool || runMediaTool;
  const probeFile = dependencies.probeFile || probeMediaFile;
  const env = dependencies.env || process.env;
  const homeDirectory = dependencies.homeDirectory || os.userInfo().homedir;
  const fileExists = dependencies.fileExists || defaultFileExists;

  return Object.freeze({
    id: PIPER_PROVIDER,
    // Домен спрашивает адаптер, умеет ли он темп речи, прежде чем планировать
    // пересинтез: ElevenLabs, например, не умеет — и решение должно это учесть.
    supportsSpeechRate: true,
    async synthesize({ text, language = "ru", voice, outputPath, lengthScale, signal } = {}) {
      signal?.throwIfAborted();
      const script = normalizeNarrationScript(text);
      const speechRate = normalizeLengthScale(lengthScale);
      const normalizedLanguage = normalizeNarrationLanguage(language);
      const outputFile = assertSafeGeneratedPath(outputPath);
      const availability = await describePiperAvailability({
        language: normalizedLanguage,
        voice,
        env,
        homeDirectory,
        fileExists
      });
      if (availability.status !== "executable") {
        throw new RangeError(`Piper narration is not executable: ${availability.status}`);
      }
      const command = {
        id: "tts",
        tool: "piper",
        argv: [
          "--model", availability.modelPath,
          "--output_file", outputFile,
          "--noise_scale", PIPER_NOISE_SCALE,
          "--noise_w", PIPER_NOISE_WIDTH,
          "--sentence_silence", PIPER_SENTENCE_SILENCE,
          // Темп добавляется только когда он отличается от дефолтного 1.0:
          // без цели длительности argv остаётся байт-в-байт прежним, а с ним —
          // и хеши манифеста повторного рендера.
          ...(speechRate === 1 ? [] : ["--length_scale", speechRate.toFixed(3)])
        ]
      };
      await runTool(command.tool, command.argv, {
        timeoutMs: 300000,
        signal,
        stdinText: `${script}\n`
      });
      signal?.throwIfAborted();
      const probe = await probeFile(outputFile, { signal });
      if (!probe?.audio) throw new TypeError("Narration output does not contain an audio stream");
      return {
        provider: PIPER_PROVIDER,
        model: availability.voice,
        voice: availability.voice,
        language: normalizedLanguage,
        lengthScale: speechRate,
        durationSeconds: Number(probe.durationSeconds),
        sampleRate: Number(probe.audio.sampleRate || 0),
        channels: Number(probe.audio.channels || 0),
        codec: String(probe.audio.codec || "unknown"),
        scriptSha256: createHash("sha256").update(script).digest("hex"),
        warnings: [],
        command
      };
    }
  });
}

async function defaultFileExists(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
