import { createHash } from "node:crypto";
import path from "node:path";
import { rm, writeFile } from "node:fs/promises";

import { buildFliteAudioArgs, assertSafeGeneratedPath } from "./ffmpeg-args.js";
import { probeMediaFile, runMediaTool } from "./process-runner.js";

const MAX_NARRATION_CHARS = 100000;
const FLITE_PROVIDER = "ffmpeg-flite";

export function createFliteNarrationAdapter(dependencies = {}) {
  const writeText = dependencies.writeText || writeFile;
  const removeFile = dependencies.removeFile || (filePath => rm(filePath, { force: true }));
  const runTool = dependencies.runTool || runMediaTool;
  const probeFile = dependencies.probeFile || probeMediaFile;

  return Object.freeze({
    id: FLITE_PROVIDER,
    // Тот же контракт, что у Piper: локальный синтез сырой и полируется на
    // канонизации. См. producesRawVoice в piper-tts.js.
    producesRawVoice: true,
    async synthesize({ text, language = "en", voice = "slt", outputPath, signal } = {}) {
      signal?.throwIfAborted();
      const script = normalizeScript(text);
      const outputFile = assertSafeGeneratedPath(outputPath);
      const textFile = assertSafeGeneratedPath(path.join(path.dirname(outputFile), "narration.txt"));
      let wroteText = false;
      try {
        await writeText(textFile, `${script}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        wroteText = true;
        signal?.throwIfAborted();
        const command = {
          id: "tts",
          tool: "ffmpeg",
          argv: buildFliteAudioArgs({
            textFile,
            outputFile,
            voice
          })
        };
        await runTool(command.tool, command.argv, {
          timeoutMs: 300000,
          signal
        });
        signal?.throwIfAborted();
        const probe = await probeFile(outputFile, { signal });
        if (!probe?.audio) throw new TypeError("Narration output does not contain an audio stream");
        return {
          provider: FLITE_PROVIDER,
          model: "flite",
          voice,
          language: normalizeLanguage(language),
          durationSeconds: Number(probe.durationSeconds),
          sampleRate: Number(probe.audio.sampleRate || 0),
          channels: Number(probe.audio.channels || 0),
          codec: String(probe.audio.codec || "unknown"),
          scriptSha256: createHash("sha256").update(script).digest("hex"),
          warnings: languageWarning(language),
          command
        };
      } finally {
        if (wroteText) await removeFile(textFile);
      }
    }
  });
}

export function normalizeNarrationScript(value) {
  return normalizeScript(value);
}

export function normalizeNarrationLanguage(value) {
  return normalizeLanguage(value);
}

function normalizeScript(value) {
  if (typeof value !== "string") throw new TypeError("Narration text must be a string");
  const text = value.trim();
  if (!text) throw new TypeError("Narration text must not be empty");
  if (text.length > MAX_NARRATION_CHARS) {
    throw new RangeError(`Narration text limit is ${MAX_NARRATION_CHARS} characters`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new TypeError("Narration text contains unsupported control characters");
  }
  return text;
}

function normalizeLanguage(value) {
  const language = typeof value === "string" ? value.trim().toLowerCase() : "";
  return language || "en";
}

function languageWarning(language) {
  return normalizeLanguage(language).startsWith("en")
    ? []
    : ["offline_flite_voice_is_english_only"];
}
