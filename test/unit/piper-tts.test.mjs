import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import {
  createPiperNarrationAdapter,
  describePiperAvailability,
  getPiperVoiceCatalog,
  resolvePiperVoice,
  resolvePiperVoicesDirectory
} from "../../src/media/piper-tts.js";
import { resolvePiperBinaryPath } from "../../src/media/process-runner.js";
import { selectNarrationAdapter } from "../../src/media/narration.js";

const HOME = "/home/tester";
const BINARY = `${HOME}/.local/opt/piper/piper`;
const VOICES = `${HOME}/.local/share/piper/voices`;

function existsCatalog(paths) {
  return async filePath => paths.includes(filePath);
}

test("Piper voice catalog covers the launch language matrix", () => {
  const catalog = getPiperVoiceCatalog();
  for (const language of ["ru", "en", "es", "de", "fr"]) {
    assert.ok(Array.isArray(catalog[language]) && catalog[language].length > 0, language);
  }
  assert.equal(resolvePiperVoice({ language: "ru" }), "ru_RU-dmitri-medium");
  assert.equal(resolvePiperVoice({ language: "ru-RU", voice: "ru_RU-irina-medium" }), "ru_RU-irina-medium");
  assert.equal(resolvePiperVoice({ language: "en" }), "en_US-lessac-medium");
  assert.equal(resolvePiperVoice({ language: "ja" }), null);
});

test("Piper voice resolution fails closed on unknown or unsafe voice names", () => {
  assert.throws(() => resolvePiperVoice({ language: "ru", voice: "../evil" }), TypeError);
  assert.throws(() => resolvePiperVoice({ language: "ru", voice: "ru_RU-unknown-medium" }), TypeError);
  assert.throws(() => resolvePiperVoice({ language: "ru", voice: 42 }), TypeError);
});

test("Piper binary and voices directory resolution honors env and rejects unsafe paths", () => {
  assert.equal(resolvePiperBinaryPath({ env: {}, homeDirectory: HOME }), BINARY);
  assert.equal(
    resolvePiperBinaryPath({ env: { HERMEST_PIPER_PATH: "/opt/piper/piper" }, homeDirectory: HOME }),
    "/opt/piper/piper"
  );
  assert.throws(
    () => resolvePiperBinaryPath({ env: { HERMEST_PIPER_PATH: "relative/piper" }, homeDirectory: HOME }),
    RangeError
  );
  assert.equal(resolvePiperVoicesDirectory({ env: {}, homeDirectory: HOME }), VOICES);
  assert.throws(
    () => resolvePiperVoicesDirectory({ env: { HERMEST_PIPER_VOICES_DIR: "bad dir" }, homeDirectory: HOME }),
    RangeError
  );
});

test("Piper remains executable when an agent profile scopes HOME", { concurrency: false }, async () => {
  const originalHome = process.env.HOME;
  const accountHome = os.userInfo().homedir;
  const accountBinary = `${accountHome}/.local/opt/piper/piper`;
  const accountModel = `${accountHome}/.local/share/piper/voices/ru_RU-dmitri-medium.onnx`;
  const events = [];

  process.env.HOME = "/tmp/hermes-profile-home";
  try {
    const adapter = await selectNarrationAdapter({
      language: "ru",
      dependencies: {
        env: {},
        fileExists: existsCatalog([accountBinary, accountModel]),
        runTool: async (tool, args) => events.push([tool, args]),
        probeFile: async () => ({
          durationSeconds: 1,
          audio: { codec: "pcm_s16le", sampleRate: 22050, channels: 1 }
        })
      }
    });
    assert.equal(adapter.id, "piper");
    await adapter.synthesize({
      text: "Проверка профиля.",
      language: "ru",
      outputPath: "/tmp/hermest-board-run/narration.wav"
    });
    assert.equal(events[0][0], "piper");
    assert.equal(events[0][1][1], accountModel);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
});

test("Piper availability reports missing binary, missing voice and executable states", async () => {
  const model = `${VOICES}/ru_RU-dmitri-medium.onnx`;
  const base = { language: "ru", env: {}, homeDirectory: HOME };

  const missingBinary = await describePiperAvailability({ ...base, fileExists: existsCatalog([model]) });
  assert.equal(missingBinary.status, "missing_binary");

  const missingVoice = await describePiperAvailability({ ...base, fileExists: existsCatalog([BINARY]) });
  assert.equal(missingVoice.status, "missing_voice_model");

  const noLanguage = await describePiperAvailability({
    ...base,
    language: "ja",
    fileExists: existsCatalog([BINARY])
  });
  assert.equal(noLanguage.status, "no_voice_for_language");

  const executable = await describePiperAvailability({ ...base, fileExists: existsCatalog([BINARY, model]) });
  assert.equal(executable.status, "executable");
  assert.equal(executable.voice, "ru_RU-dmitri-medium");
  assert.equal(executable.modelPath, model);
});

test("Piper narration adapter synthesizes through stdin and returns auditable metadata", async () => {
  const model = `${VOICES}/ru_RU-dmitri-medium.onnx`;
  const events = [];
  const adapter = createPiperNarrationAdapter({
    env: {},
    homeDirectory: HOME,
    fileExists: existsCatalog([BINARY, model]),
    runTool: async (tool, args, options) => events.push(["run", tool, args, options]),
    probeFile: async () => ({
      durationSeconds: 4.66,
      audio: { codec: "pcm_s16le", sampleRate: 22050, channels: 1 }
    })
  });
  const result = await adapter.synthesize({
    text: "Проверка живого русского голоса.",
    language: "ru",
    outputPath: "/tmp/hermest-board-run/narration.wav"
  });

  assert.equal(events.length, 1);
  const [, tool, argv, options] = events[0];
  assert.equal(tool, "piper");
  assert.deepEqual(argv, [
    "--model", model,
    "--output_file", "/tmp/hermest-board-run/narration.wav",
    "--noise_scale", "0",
    "--noise_w", "0",
    "--sentence_silence", "0.35"
  ]);
  assert.equal(options.stdinText, "Проверка живого русского голоса.\n");
  assert.equal(result.provider, "piper");
  assert.equal(result.voice, "ru_RU-dmitri-medium");
  assert.equal(result.language, "ru");
  assert.equal(result.durationSeconds, 4.66);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.command.id, "tts");
  assert.equal(result.command.tool, "piper");
  assert.ok(/^[0-9a-f]{64}$/.test(result.scriptSha256));
});

test("Piper speech rate reaches argv only when a target duration changed it", async () => {
  const model = `${VOICES}/ru_RU-dmitri-medium.onnx`;
  const events = [];
  const adapter = createPiperNarrationAdapter({
    env: {},
    homeDirectory: HOME,
    fileExists: existsCatalog([BINARY, model]),
    runTool: async (tool, args) => events.push(args),
    probeFile: async () => ({
      durationSeconds: 4.1,
      audio: { codec: "pcm_s16le", sampleRate: 22050, channels: 1 }
    })
  });
  assert.equal(adapter.supportsSpeechRate, true);

  const base = {
    text: "Проверка темпа речи.",
    language: "ru",
    outputPath: "/tmp/hermest-board-run/narration.wav"
  };

  const withoutRate = await adapter.synthesize(base);
  assert.equal(events[0].includes("--length_scale"), false);
  assert.equal(withoutRate.lengthScale, 1);

  const slower = await adapter.synthesize({ ...base, lengthScale: 0.88 });
  assert.deepEqual(events[1].slice(-2), ["--length_scale", "0.880"]);
  assert.equal(slower.lengthScale, 0.88);

  // Ровно 1.0 — это «темп не менялся»: argv обязан остаться прежним, иначе
  // хеши манифеста разъедутся на рендере без цели длительности.
  await adapter.synthesize({ ...base, lengthScale: 1 });
  assert.deepEqual(events[2], events[0]);
});

test("Piper rejects a speech rate outside the audible corridor", async () => {
  const model = `${VOICES}/ru_RU-dmitri-medium.onnx`;
  const adapter = createPiperNarrationAdapter({
    env: {},
    homeDirectory: HOME,
    fileExists: existsCatalog([BINARY, model]),
    runTool: async () => {
      throw new Error("must not run");
    },
    probeFile: async () => ({
      durationSeconds: 1,
      audio: { codec: "pcm_s16le", sampleRate: 22050, channels: 1 }
    })
  });
  const base = {
    text: "Проверка.",
    language: "ru",
    outputPath: "/tmp/hermest-board-run/narration.wav"
  };

  await assert.rejects(adapter.synthesize({ ...base, lengthScale: 0.5 }), RangeError);
  await assert.rejects(adapter.synthesize({ ...base, lengthScale: 1.5 }), RangeError);
  await assert.rejects(adapter.synthesize({ ...base, lengthScale: true }), TypeError);
  await assert.rejects(adapter.synthesize({ ...base, lengthScale: "быстрее" }), TypeError);
});

test("Piper narration adapter fails closed when not executable", async () => {
  const adapter = createPiperNarrationAdapter({
    env: {},
    homeDirectory: HOME,
    fileExists: existsCatalog([]),
    runTool: async () => {
      throw new Error("must not run");
    }
  });
  await assert.rejects(
    adapter.synthesize({ text: "test", language: "ru", outputPath: "/tmp/hermest-board-run/narration.wav" }),
    RangeError
  );
});

test("Narration selector prefers Piper for supported languages and falls back honestly", async () => {
  const model = `${VOICES}/ru_RU-dmitri-medium.onnx`;
  const withPiper = { env: {}, homeDirectory: HOME, fileExists: existsCatalog([BINARY, model]) };
  const withoutPiper = { env: {}, homeDirectory: HOME, fileExists: existsCatalog([]) };

  const piperAdapter = await selectNarrationAdapter({ language: "ru", dependencies: withPiper });
  assert.equal(piperAdapter.id, "piper");

  const fallbackAdapter = await selectNarrationAdapter({ language: "ru", dependencies: withoutPiper });
  assert.equal(fallbackAdapter.id, "ffmpeg-flite");

  const forcedFlite = await selectNarrationAdapter({
    language: "ru",
    provider: "ffmpeg-flite",
    dependencies: withPiper
  });
  assert.equal(forcedFlite.id, "ffmpeg-flite");

  await assert.rejects(
    selectNarrationAdapter({ language: "ru", provider: "piper", dependencies: withoutPiper }),
    RangeError
  );
});
